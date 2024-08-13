import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import {getOctokit} from './github'
import * as cache from "@actions/cache";
import * as core from "@actions/core";
import Ajv2020 from "ajv/dist/2020"
import * as yaml from 'js-yaml';
import * as tc from "@actions/tool-cache";
import {debug} from "@actions/core";

interface ToolInfo {
    owner: string;
    project: string;
    tag: string;
    osPlatform: string;
    osArch: string;
}

interface Config {
    owner: string;
    project: string;
    tag: string
    platform: string
    arch: string
    extension: string
    extension_matching: boolean
    rename_to: string
    chmod: string
    binaries_location: string
}



export async function run() {
    try {
        // set up auth/environment
        const token = process.env['GITHUB_TOKEN'] || core.getInput("token")
        const config = core.getInput("config");

        const ajv = new Ajv2020()

        const schemaJsonFile = 'config.schema.json'
        const configJson = yaml.load(config);

        // load schema json file
        const schemaJson = JSON.parse(fs.readFileSync(schemaJsonFile, 'utf8'));
        // validate input json against schema json
        const isValid = ajv.validate(schemaJson, configJson);
        if (! isValid) {
            throw new Error(
                ajv.errorsText()
            )
        }

        let binariesLocation = core.getInput("binaries-location");
        const cacheEnabled = (core.getInput("cache") === "enable")

        let configs : Map<string, Config> = new Map<string, Config>();

        for (let repo in (configJson as object))  {
            let config = (configJson as object)[repo];
            // tag = !tag ? "latest" : tag
            if (config == null) {
                configs[repo] = {
                    owner: repo.split('/')[0],
                    project: repo.split('/')[1],
                    tag: "latest",
                    platform: defaultPlatform(),
                    arch: defaultArch(),
                    extension: "",
                    extension_matching: false,
                    rename_to: "",
                    chmod: "",
                }
            } else if (config.type === 'string') {
                configs[repo] = {
                    owner: repo.split('/')[0],
                    project: repo.split('/')[1],
                    tag: config === "" ? "latest" : config,
                    platform: defaultPlatform(),
                    arch: defaultArch(),
                    extension: "",
                    extension_matching: false,
                    rename_to: "",
                    chmod: "",
                }
            } else if (config.type == 'object') {
                configs[repo] = {
                    owner: repo.split('/')[0],
                    project: repo.split('/')[1],
                    tag: config.tag === "" ? "latest" : config.tag,
                    platform: config.platform === "" ? defaultPlatform() : config.platform,
                    arch: config.arch === "" ? defaultArch() : config.arch,
                    extension: config.extension,
                    extension_matching: config.extension_matching === "enable" || config.extension_matching === "true",
                    rename_to: config.rename_to,
                    chmod: config.chmod,
                }
            }
        }
        const octokit = getOctokit(token)
        for (let repo in configs)  {
            downloadRelease(octokit, configs[repo], cacheEnabled, binariesLocation)
        }

    } catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        } else {
            core.setFailed("catastrophic failure, please file an issue")
        }
    }
}

function defaultPlatform() {
    switch (os.platform()) {
        case "linux":
            return "linux";
        case "darwin":
            return "darwin";
        case "win32":
            return "windows";
        default:
            core.setFailed("Unsupported operating system - $this action is only released for Darwin, Linux and Windows");
            return null;
    }
}

function defaultArch() {
    switch (os.arch()) {
        case "x64":
            return ["x86_64", "x64", "amd64"]
        default:
            return [os.arch()]
    }
}

async function downloadRelease(octokit, config: Config, cache_enabled: boolean, binary_location: string): Promise<boolean> {

    let dest = toolPath(config);

    let finalBinLocation = dest;
    if (binary_location !== "") {
        core.debug(`==> Given bin location: ${binary_location}`);
        finalBinLocation = path.join(dest, binary_location);
    }
    core.debug(`==> Binaries will be located at: ${finalBinLocation}`);

    let cacheKey = cachePrimaryKey(config);
    if (cache_enabled && cacheKey !== undefined) {
        let ok = await cache.restoreCache([dest], cacheKey);
        if (ok !== undefined) {
            core.debug(`Found ${config.project} in the cache: ${dest}`)
            core.debug(`Adding ${finalBinLocation} to the path`);
            core.addPath(finalBinLocation);
            return false;
        }
    }

    let getReleaseUrl;
    if (config.tag === "latest") {
        getReleaseUrl = await octokit.rest.repos.getLatestRelease({
            owner: config.owner,
            repo: config.project,
        })
    } else {
        getReleaseUrl = await octokit.rest.repos.getReleaseByTag({
            owner: config.owner,
            repo: config.project,
            tag: config.tag,
        })
    }

    // Determine File Extensions (if any)
    let extMatchRegexForm = "";
    if (config.extension_matching) {
        if (config.extension === "") {
            extMatchRegexForm = "\.(tar.gz|zip|tgz)";
            core.debug(`==> Using default file extension matching: ${extMatchRegexForm}`);
        } else {
            extMatchRegexForm = config.extension;
            core.debug(`==> Using custom file extension matching: ${extMatchRegexForm}`);
        }
    } else {
        core.debug("==> File extension matching disabled");
    }

    let osMatch = [config.platform].concat(config.arch)
    let osMatchRegexForm = `(${osMatch.join('|')})`
    let re = new RegExp(`${osMatchRegexForm}.*${osMatchRegexForm}.*${extMatchRegexForm}`)
    let asset = getReleaseUrl.data.assets.find(obj => {
        core.debug(`searching for ${obj.name} with ${re.source}`)
        let normalized_obj_name = obj.name.toLowerCase()
        return re.test(normalized_obj_name)
    })

    if (!asset) {
        const found = getReleaseUrl.data.assets.map(f => f.name)
        throw new Error(
            `Could not find a release for ${!config.tag ? "latest" : config.tag}. Found: ${found}`
        )
    }

    const url = asset.url

    core.debug(`Downloading ${config.project} from ${url}`)
    const binPath = await tc.downloadTool(url,
        undefined,
        `token ${octokit.token}`,
        {
            accept: 'application/octet-stream'
        }
    );

    const extractFn = getExtractFn(asset.name)
    if (extractFn !== undefined) {
        // Release is an archive file so extract it to the destination
        const extractFlags = getExtractFlags(asset.name)
        if (extractFlags !== undefined) {
            core.debug(`Attempting to extract archive with custom flags ${extractFlags}`)
            await extractFn(binPath, dest, extractFlags);
        } else {
            await extractFn(binPath, dest);
        }
        core.debug(`Automatically extracted release asset ${asset.name} to ${dest}`);

        const bins = fs.readdirSync(finalBinLocation, { withFileTypes: true })
            .filter(item => item.isFile())
            .map(bin => bin.name);
        if (bins.length === 0)
            throw new Error(`No files found in ${finalBinLocation}`);
        else if (bins.length > 1 && config.rename_to !== "") {
            core.warning("rename-to parameter ignored when installing \
                a release from an archive that contains multiple files.");
        }

        if (config.chmod !== "") {
            bins.forEach(bin => {
                const binPath = path.join(finalBinLocation, bin);
                try {
                    fs.chmodSync(binPath, config.chmod);
                    core.debug(`chmod'd ${binPath} to ${config.chmod}`)
                } catch (chmodErr) {
                    core.setFailed(`Failed to chmod ${binPath} to ${config.chmod}: ${chmodErr}`);
                }
            });
        }
    } else {
        // As it wasn't an archive we've just downloaded it as a blob, this uses an auto-assigned name which will
        // be a UUID which is likely meaningless to the caller.  If they have specified a rename-to and a chmod
        // parameter then this is where we apply those.
        // Regardless of any rename-to parameter we still need to move the download to the actual destination
        // otherwise it won't end up on the path as expected
        core.debug(
            `Release asset ${asset.name} did not have a recognised file extension, unable to automatically extract it`)
        try {
            fs.mkdirSync(dest, { 'recursive': true });

            const outputPath = path.join(dest, config.rename_to !== "" ? config.rename_to : path.basename(binPath));
            core.debug(`Created output directory ${dest}`);

            var moveFailed = false;

            try {
                fs.renameSync(binPath, outputPath);
            } catch (renameErr) {
                if (renameErr instanceof Error && 'code' in renameErr && renameErr.code === 'EXDEV')  {
                    core.debug(`Falling back to copy and remove, due to: ${renameErr}`);
                    try {
                        fs.copyFileSync(binPath, outputPath);
                        fs.rmSync(binPath);
                    } catch (copyRemoveErr) {
                        moveFailed = true;
                        core.setFailed(`Failed to copy and remove downloaded release asset ${asset.name} from ${binPath} to ${outputPath}: ${copyRemoveErr}`);
                    }
                } else {
                    moveFailed = true;
                    core.setFailed(`Failed to move downloaded release asset ${asset.name} from ${binPath} to ${outputPath}: ${renameErr}`);
                }
            }

            if (!moveFailed) {
                core.debug(`Moved release asset ${asset.name} to ${outputPath}`);
            }

            if ((config.chmod !== "") && !moveFailed) {
                try {
                    fs.chmodSync(outputPath, config.chmod);
                    core.debug(`chmod'd ${outputPath} to ${config.chmod}`)
                } catch (chmodErr) {
                    core.setFailed(`Failed to chmod ${outputPath} to ${config.chmod}: ${chmodErr}`);
                }
            }
        } catch (err) {
            core.setFailed(`Failed to create required output directory ${dest}`);
        }
    }

    if (cache_enabled && cacheKey !== undefined) {
        try {
            await cache.saveCache([dest], cacheKey);
        } catch (error) {
            const typedError = error as Error;
            if (typedError.name === cache.ValidationError.name) {
                throw error;
            } else if (typedError.name === cache.ReserveCacheError.name) {
                core.debug(typedError.message);
            } else {
                core.warning(typedError.message);
            }
        }
    }

    core.debug(`Adding ${finalBinLocation} to the path`);
    core.addPath(finalBinLocation);
    core.debug(`Successfully installed ${config.project}`);
    core.debug(`Binaries available at ${finalBinLocation}`);

    return true
}

function getExtractFn(assetName: any) {
    if (assetName.endsWith('.tar.gz') || assetName.endsWith('.tar.bz2') || assetName.endsWith('.tgz')) {
        return tc.extractTar;
    } else if (assetName.endsWith('.zip')) {
        return tc.extractZip;
    } else {
        return undefined;
    }
}

function getExtractFlags(assetName: any) {
    if (assetName.endsWith('tar.bz2')) {
        return "xj";
    } else {
        return undefined;
    }
}

function toolPath(info: Config): string {
    return path.join(getCacheDirectory(), info.owner, info.project, info.tag, `${info.platform}-${info.arch}`);
}

function getCacheDirectory() {
    const cacheDirectory = process.env['RUNNER_TOOL_CACHE'] || '';
    if (cacheDirectory === '') {
        core.warning('Expected RUNNER_TOOL_CACHE to be defined');
    }
    return cacheDirectory;
}


function cachePrimaryKey(info: Config): string | undefined {
    // Currently not caching "latest" versions of the tool.
    if (info.tag === "latest") {
        return undefined;
    }
    return "action-install-gh-release/" +
        `${info.owner}/${info.project}/${info.tag}/${info.platform}-${info.arch}`;
}


