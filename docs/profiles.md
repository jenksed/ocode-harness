# Profiles

## Overview

Profiles in ocode-harness provide configuration presets for different use cases and environments. Each profile defines:

- **Provider**: The AI provider configuration (FreeLLMAPI, OpenAI, etc.)
- **Models**: Available models and their limits
- **Default Agent**: The orchestrator agent to use
- **Subagent Depth**: Maximum depth for subagent delegation
- **Task Allowlist**: List of allowed subagent types

## Default Profile

The default profile (`profiles/default.json`) provides a minimal configuration:

```json
{
  "description": "Default profile for ocode-harness v0.1",
  "provider": {
    "freellmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "FreeLLMAPI",
      "options": {
        "baseURL": "http://127.0.0.1:3001/v1",
        "apiKey": "{env:FREELLMAPI_API_KEY}"
      },
      "models": {
        "auto:smart": {
          "name": "FreeLLMAPI Smart Router",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  },
  "default_agent": "orchestrator",
  "subagent_depth": 1,
  "task_allowlist": [
    "planner",
    "coder",
    "researcher",
    "verifier",
    "reviewer",
    "judge",
    "committer"
  ]
}
```

### Features

- Uses FreeLLMAPI with environment variable-based API key
- Configurable base URL with default value
- Single model: auto:smart (FreeLLMAPI Smart Router)
- Orchestrator as default agent
- Subagent depth limited to 1
- Task allowlist restricted to harness subagents only

### Usage

To use the default profile, set it in your opencode configuration:

```bash
# Edit ~/.config/opencode/opencode.json
# Set "profile": "default" in the top-level configuration
```

## FreeLLMAPI Profile

The FreeLLMAPI profile (`profiles/freellmapi.json`) provides a complete configuration:

```json
{
  "provider": {
    "freellmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "FreeLLMAPI",
      "options": {
        "baseURL": "http://127.0.0.1:3001/v1",
        "apiKey": "{env:FREELLMAPI_API_KEY}"
      },
      "models": {
        "auto:smart": {
          "name": "FreeLLMAPI Smart Router",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:fast": {
          "name": "FreeLLMAPI Fast Router",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:balanced": {
          "name": "FreeLLMAPI Balanced Router",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:orchestrator": {
          "name": "FreeLLMAPI Orchestrator Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:planner": {
          "name": "FreeLLMAPI Planner Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:coder": {
          "name": "FreeLLMAPI Coder Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:reviewer": {
          "name": "FreeLLMAPI Reviewer Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:researcher": {
          "name": "FreeLLMAPI Researcher Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:verifier": {
          "name": "FreeLLMAPI Verifier Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        },
        "auto:judge": {
          "name": "FreeLLMAPI Judge Profile",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  },
  "default_agent": "orchestrator",
  "subagent_depth": 1
}
```

### Features

- Uses FreeLLMAPI with environment variable-based API key
- Configurable base URL with default value
- 10 model profiles:
  - auto:smart - FreeLLMAPI Smart Router (default)
  - auto:fast - FreeLLMAPI Fast Router
  - auto:balanced - FreeLLMAPI Balanced Router
  - auto:orchestrator - Orchestrator-specific profile
  - auto:planner - Planner-specific profile
  - auto:coder - Coder-specific profile
  - auto:reviewer - Reviewer-specific profile
  - auto:researcher - Researcher-specific profile
  - auto:verifier - Verifier-specific profile
  - auto:judge - Judge-specific profile
- Each profile has 128K context and 8K output limits
- Orchestrator as default agent
- Subagent depth limited to 1
- No task allowlist (uses default from agent definitions)

### Usage

To use the FreeLLMAPI profile:

1. Set the environment variables:
   ```bash
   export FREELLMAPI_API_KEY="your-api-key"
   export FREELLMAPI_BASE_URL="http://127.0.0.1:3001/v1"
   ```

2. Use the profile in opencode:
   ```bash
   ocode
   ```

The installer automatically uses this profile.

## Profile Structure

### Provider Configuration

```json
{
  "provider": {
    "freellmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "FreeLLMAPI",
      "options": {
        "baseURL": "http://127.0.0.1:3001/v1",
        "apiKey": "{env:FREELLMAPI_API_KEY}"
      }
    }
  }
}
```

**Fields:**
- `npm`: NPM package name for the provider
- `name`: Human-readable provider name
- `options.baseURL`: API base URL (can use `${env:VAR:default}`)
- `options.apiKey`: API key (must use `{env:VAR}` pattern)

### Model Configuration

```json
{
  "models": {
    "auto:smart": {
      "name": "FreeLLMAPI Smart Router",
      "limit": {
        "context": 128000,
        "output": 8192
      }
    }
  }
}
```

**Fields:**
- `name`: Human-readable model name
- `limit.context`: Maximum context window size (tokens)
- `limit.output`: Maximum output size (tokens)

### Agent Configuration

```json
{
  "default_agent": "orchestrator",
  "subagent_depth": 1,
  "task_allowlist": [
    "planner",
    "coder",
    "researcher",
    "verifier",
    "reviewer",
    "judge",
    "committer"
  ]
}
```

**Fields:**
- `default_agent`: Default agent to use when no agent is specified
- `subagent_depth`: Maximum depth for subagent delegation (1 = no sub-subagents)
- `task_allowlist`: List of allowed subagent types (only harness subagents)

## Custom Profiles

You can create custom profiles by copying and modifying `profiles/default.json` or `profiles/freellmapi.json`.

### Example: Local Development Profile

```json
{
  "description": "Local development profile",
  "provider": {
    "freellmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "FreeLLMAPI",
      "options": {
        "baseURL": "${FREELLMAPI_BASE_URL:http://localhost:3001/v1}",
        "apiKey": "{env:FREELLMAPI_API_KEY}"
      },
      "models": {
        "auto:smart": {
          "name": "FreeLLMAPI Smart Router (Local)",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  },
   "default_agent": "orchestrator",
   "subagent_depth": 1,
   "task_allowlist": [
     "planner",
     "coder",
     "researcher",
     "verifier",
     "reviewer",
     "judge",
     "committer"
   ]
}
```

### Example: Production Profile

```json
{
  "description": "Production profile",
  "provider": {
    "freellmapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "FreeLLMAPI",
      "options": {
        "baseURL": "${FREELLMAPI_BASE_URL:https://api.freellmapi.com/v1}",
        "apiKey": "{env:FREELLMAPI_API_KEY}"
      },
      "models": {
        "auto:smart": {
          "name": "FreeLLMAPI Smart Router (Production)",
          "limit": {
            "context": 128000,
            "output": 8192
          }
        }
      }
    }
  },
   "default_agent": "orchestrator",
   "subagent_depth": 1,
   "task_allowlist": [
     "planner",
     "coder",
     "researcher",
     "verifier",
     "reviewer",
     "judge",
     "committer"
   ]
}
```

## Profile Selection

To select a profile in opencode:

1. **Edit opencode configuration**:
   ```bash
   nano ~/.config/opencode/opencode.json
   ```

2. **Add profile field**:
   ```json
   {
     "profile": "default"
   }
   ```

3. **Restart opencode**:
   ```bash
   ocode
   ```

## Best Practices

### 1. Use Environment Variables for Secrets

Never hardcode API keys in profiles. Always use:
```json
"apiKey": "{env:FREELLMAPI_API_KEY}"
```

### 2. Set Default Base URL

Provide a sensible default for the base URL:
```json
"baseURL": "http://127.0.0.1:3001/v1"
```

### 3. Limit Subagent Depth

Set `subagent_depth` to 1 to prevent unbounded delegation:
```json
"subagent_depth": 1
```

### 4. Restrict Task Allowlist

Only include harness subagents in the allowlist:
```json
  "task_allowlist": [
    "planner",
    "coder",
    "researcher",
    "verifier",
    "reviewer",
    "judge",
    "committer"
  ]
}
```

### 5. Document Profile Purpose

Include a description field:
```json
{
  "description": "Profile for X use case"
}
```

## Troubleshooting

### Profile Not Applied

If the profile is not applied:

1. **Check Configuration**:
   ```bash
   cat ~/.config/opencode/opencode.json
   ```

2. **Verify Profile Field**:
   ```json
   {
     "profile": "default"
   }
   ```

3. **Restart opencode**:
   ```bash
   ocode
   ```

### Environment Variables Not Set

If the profile uses environment variables but they are not set:

1. **Check Variables**:
   ```bash
   echo $FREELLMAPI_API_KEY
   echo $FREELLMAPI_BASE_URL
   ```

2. **Set Variables**:
   ```bash
   export FREELLMAPI_API_KEY="your-key"
   export FREELLMAPI_BASE_URL="http://127.0.0.1:3001/v1"
   ```

3. **Make Permanent**:
   ```bash
   echo 'export FREELLMAPI_API_KEY="your-key"' >> ~/.zshrc
   echo 'export FREELLMAPI_BASE_URL="http://127.0.0.1:3001/v1"' >> ~/.zshrc
   source ~/.zshrc
   ```

## Next Steps

1. **Read Architecture**: [architecture.md](architecture.md)
2. **Read Installation**: [installation.md](installation.md)
3. **Read Doctor**: [doctor.md](doctor.md)
4. **Read Security**: [security.md](security.md)
