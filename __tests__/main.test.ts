/**
 * Unit tests for the action's main functionality, src/main.ts
 *
 * These should be run as if the action was called from a workflow.
 * Specifically, the inputs listed in `action.yml` should be set as environment
 * variables following the pattern `INPUT_<INPUT_NAME>`.
 */

import * as core from '@actions/core'
import * as main from '../src/main'
import * as octokit from "@octokit/core";
import * as github from "../src/github";
import * as tc from "@actions/tool-cache";
import fs from "fs";
import {OutgoingHttpHeaders} from "http";


// Mock the action's main function
const runMock = jest.spyOn(main, 'run')

// Other utilities
const timeRegex = /^\d{2}:\d{2}:\d{2}/

// Mock the GitHub Actions core library
let debugMock: jest.SpiedFunction<typeof core.debug>
let errorMock: jest.SpiedFunction<typeof core.error>
let getInputMock: jest.SpiedFunction<typeof core.getInput>
let setFailedMock: jest.SpiedFunction<typeof core.setFailed>
let setOutputMock: jest.SpiedFunction<typeof core.setOutput>
let octokitMock: jest.SpiedFunction<typeof github.getOctokit>
let cacheMock: jest.SpiedFunction<typeof tc.downloadTool>

describe('action', () => {
    beforeEach(() => {
        jest.clearAllMocks()

        debugMock = jest.spyOn(core, 'debug').mockImplementation()
        errorMock = jest.spyOn(core, 'error').mockImplementation()
        getInputMock = jest.spyOn(core, 'getInput').mockImplementation()
        setFailedMock = jest.spyOn(core, 'setFailed').mockImplementation()
        setOutputMock = jest.spyOn(core, 'setOutput').mockImplementation()
        octokitMock = jest.spyOn(github, 'getOctokit').mockImplementation()
        cacheMock = jest.spyOn(tc, 'downloadTool').mockImplementation()
    })

    it('sets the time output', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'token':
                    return 'random-token'
                case 'config':
                    return `
aquasecurity/tfsec:        
  tag: v1.18.0
  platform: linux
  arch: amd64
jaxxstorm/connecti: 
jaxxstorm/change-aws-credentials: v0.4.0
wasmerio/wasmer: {}
`
                default:
                    return ''
            }
        })

        const request_callback = () => new Promise((resolve, reject) => {
            resolve({status: 302, headers: {location: 'mock-url'}});
        })

        let getReleaseCallback = jest.fn().mockImplementation((owner, repo) => {
            switch (repo) {
                case 'connecti':
                    return {data: JSON.parse(fs.readFileSync("fixtures/connecti.latest.json", 'utf8'))}
                case 'wasmer':
                    return {data: JSON.parse(fs.readFileSync("fixtures/wasmer.latest.json", 'utf8'))}
                case 'change-aws-credentials':
                    return {data: JSON.parse(fs.readFileSync("fixtures/change-aws-credentials.v1.18.0.json", 'utf8'))}
                case 'tfsec':
                    return {data: JSON.parse(fs.readFileSync("fixtures/tfsec.v1.18.0.json", 'utf8'))}
                default:
                    return {data: JSON.parse(fs.readFileSync("__tests__/fixtures/tfsec.v1.18.0.json", 'utf8'))}
            }
        })

        octokitMock.mockImplementation(token => {
            return {
                rest: {
                    repos: {
                        getLatestRelease: getReleaseCallback,
                        getReleaseByTag: getReleaseCallback
                    }
                }
            } as unknown as octokit.Octokit
        })

        cacheMock.mockImplementation( (url: string, dest?: string, auth?: string, headers?: OutgoingHttpHeaders) => {
            return new Promise<string>((resolve, reject) => {
                resolve('mock-path')
            })
        })

        await main.run()
        expect(octokitMock).toHaveBeenCalled()
        expect(cacheMock).toHaveBeenCalled()
        expect(runMock).toHaveReturned()

        expect(errorMock).not.toHaveBeenCalled()
        expect(setFailedMock).not.toHaveBeenCalled()
    })

    it('sets a failed status', async () => {
        // Set the action's inputs as return values from core.getInput()
        getInputMock.mockImplementation(name => {
            switch (name) {
                case 'token':
                    return 'random-token'
                case 'config':
                    return 'test'
                default:
                    return ''
            }
        })


        await main.run()
        expect(runMock).toHaveReturned()

        // Verify that all of the core library functions were called correctly
        expect(setFailedMock).toHaveBeenNthCalledWith(
            1,
            'Config is not a valid YAML string'
        )
        expect(errorMock).not.toHaveBeenCalled()
    })
})
