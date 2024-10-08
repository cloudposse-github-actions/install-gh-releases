export const schema = {
    "type": "object",
    "additionalProperties": false,
    "unevaluatedProperties": false,
    "patternProperties": {
        "^(.*)/(.*)$": {
            "oneOf": [
                {
                    "type": "string"
                },
                {
                    "type": "object",
                    "additionalProperties": false,
                    "properties": {
                        "skip": {
                            "type": "boolean",
                            "default": false
                        },
                        "tag": {
                            "type": "string"
                        },
                        "platform": {
                            "type": "string"
                        },
                        "arch": {
                            "type": "string"
                        },
                        "extension": {
                            "type": "string"
                        },
                        "extension-matching": {
                            "type": "boolean",
                            "default": false
                        },
                        "binaries-location": {
                            "type": "string"
                        },
                        "rename-to": {
                            "type": "string"
                        },
                        "chmod": {
                            "oneOf": [
                                {
                                    "type": "string"
                                },
                                {
                                    "type": "integer"
                                }
                            ]
                        }
                    }
                },
                {
                    "type": "null"
                }
            ]
        }
    }
}