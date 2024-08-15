<!-- markdownlint-disable -->

## Inputs

| Name | Description | Default | Required |
|------|-------------|---------|----------|
| cache | When set to 'true', caches the releases of known tags with actions/cache | N/A | false |
| config | Releases configuration to install (YAML format) | N/A | true |
| token | GITHUB\_TOKEN or a `repo` scoped Personal Access Token (PAT) | ${{ github.token }} | false |


<!-- markdownlint-restore -->
