#!/usr/bin/env bash
# engram scaffold — Generate engram batch import commands from a repository's structure.
#
# Scans a repo and outputs `engram batch` commands for top-level modules,
# API endpoints, services, and dependency edges. Meant as a STARTING POINT
# that a human or LLM enriches with descriptions and business context.
#
# Usage:
#   ./scaffold.sh <repo-path> <model-name> [--dry-run]
#
# Example:
#   ./scaffold.sh ~/Hashbranch/hb-fleet-rest hashbranch
#   ./scaffold.sh ~/Personal/chitin personal-projects --dry-run

set -euo pipefail

REPO="${1:?Usage: scaffold.sh <repo-path> <model-name> [--dry-run]}"
MODEL="${2:?Usage: scaffold.sh <repo-path> <model-name> [--dry-run]}"
DRY_RUN="${3:-}"

REPO_NAME=$(basename "$REPO")
BATCH_FILE=$(mktemp /tmp/engram-scaffold-XXXXXXXX)

# Colors
if command -v tput &>/dev/null && [ -t 1 ]; then
  BOLD=$(tput bold); DIM=$(tput dim); RESET=$(tput sgr0)
  GREEN=$(tput setaf 2); BLUE=$(tput setaf 4); YELLOW=$(tput setaf 3)
else
  BOLD=""; DIM=""; RESET=""; GREEN=""; BLUE=""; YELLOW=""
fi

echo "${BOLD}Engram Scaffold: ${REPO_NAME}${RESET}"
echo "${DIM}Model: ${MODEL} | Repo: ${REPO}${RESET}"
echo ""

if [ ! -d "$REPO/.git" ]; then
  echo "Error: $REPO is not a git repository" >&2
  exit 1
fi

cd "$REPO"

# --- Detect repo type ---
REPO_TYPE="unknown"
if [ -f "package.json" ]; then
  REPO_TYPE="node"
elif [ -f "Cargo.toml" ]; then
  REPO_TYPE="rust"
elif [ -f "go.mod" ]; then
  REPO_TYPE="go"
elif [ -f "pyproject.toml" ] || [ -f "setup.py" ]; then
  REPO_TYPE="python"
fi

echo "${BLUE}Detected type:${RESET} $REPO_TYPE"

# --- Helper: add a batch line ---
emit() {
  echo "$1" >> "$BATCH_FILE"
}

# --- Always create the repo node ---
DESC=""
if [ -f "package.json" ]; then
  DESC=$(python3 -c "import json; d=json.load(open('package.json')); print(d.get('description',''))" 2>/dev/null || echo "")
fi
emit "add ${REPO_NAME} -t repository -m description=\"${DESC}\" path=\"${REPO}\""

# --- Scan for top-level source directories (modules/services) ---
SRC_DIRS=()
for dir in src/modules src/services src/commands src/api src/routes lib/modules packages apps; do
  if [ -d "$dir" ]; then
    SRC_DIRS+=("$dir")
  fi
done

# --- Node.js/TypeScript: Scan modules ---
if [ "$REPO_TYPE" = "node" ]; then
  # Scan src/modules/ (Medusa, NestJS, etc.)
  if [ -d "src/modules" ]; then
    echo "${GREEN}Found src/modules/${RESET}"
    for module_dir in src/modules/*/; do
      if [ -d "$module_dir" ]; then
        module_name=$(basename "$module_dir")
        emit "add ${module_name} -t module -m path=\"${module_dir}\""
        emit "link ${REPO_NAME} contains ${module_name}"
      fi
    done
  fi

  # Scan src/commands/ (CLI tools)
  if [ -d "src/commands" ]; then
    echo "${GREEN}Found src/commands/${RESET}"
    for cmd_file in src/commands/*.ts src/commands/*.js; do
      if [ -f "$cmd_file" ]; then
        cmd_name=$(basename "$cmd_file" | sed 's/\.\(ts\|js\)$//')
        emit "add cmd-${cmd_name} -t component -m path=\"${cmd_file}\" type=\"command\""
        emit "link ${REPO_NAME} contains cmd-${cmd_name}"
      fi
    done
  fi

  # Scan API routes (src/api/**)
  if [ -d "src/api" ]; then
    echo "${GREEN}Found src/api/${RESET}"
    # Get top-level API groups (admin, store, customer, webhook, etc.)
    for api_group in src/api/*/; do
      if [ -d "$api_group" ]; then
        group_name=$(basename "$api_group")
        emit "add api-${group_name} -t component -m path=\"${api_group}\" type=\"api-group\""
        emit "link ${REPO_NAME} contains api-${group_name}"
      fi
    done
  fi

  # Scan src/services/ (NestJS services)
  if [ -d "src/services" ]; then
    echo "${GREEN}Found src/services/${RESET}"
    for svc_file in src/services/*.ts src/services/*.js; do
      if [ -f "$svc_file" ]; then
        svc_name=$(basename "$svc_file" | sed 's/\.\(ts\|js\)$//' | sed 's/\.service$//')
        emit "add svc-${svc_name} -t service -m path=\"${svc_file}\""
        emit "link ${REPO_NAME} contains svc-${svc_name}"
      fi
    done
  fi

  # Scan NestJS modules (src/modules/*/module.ts pattern)
  if [ -d "src/modules" ]; then
    for module_file in src/modules/*/module.ts src/modules/*/*.module.ts; do
      if [ -f "$module_file" ]; then
        module_dir=$(dirname "$module_file")
        module_name=$(basename "$module_dir")
        # Check for controller files → indicates API endpoints
        for controller in "$module_dir"/*controller* "$module_dir"/*Controller*; do
          if [ -f "$controller" ]; then
            emit "add ${module_name}-controller -t endpoint -m path=\"${controller}\""
            emit "link ${module_name} contains ${module_name}-controller"
            break
          fi
        done
      fi
    done
  fi

  # Scan package.json dependencies for known services
  if [ -f "package.json" ]; then
    deps=$(python3 -c "
import json
d = json.load(open('package.json'))
all_deps = list(d.get('dependencies', {}).keys()) + list(d.get('devDependencies', {}).keys())
# Filter to interesting deps (frameworks, DBs, etc.)
interesting = [dep for dep in all_deps if any(kw in dep for kw in ['express', 'nestjs', 'medusa', 'prisma', 'typeorm', 'mikro-orm', 'sequelize', 'mongoose', 'redis', 'bull', 'stripe', 'auth0', 'sendgrid', 'twilio'])]
for dep in interesting:
    print(dep)
" 2>/dev/null || true)
    if [ -n "$deps" ]; then
      echo "${GREEN}Key dependencies:${RESET} $(echo "$deps" | tr '\n' ', ')"
    fi
  fi

  # Scan clients/ directory (external API clients)
  if [ -d "clients" ]; then
    echo "${GREEN}Found clients/${RESET}"
    for client_dir in clients/*/; do
      if [ -d "$client_dir" ]; then
        client_name=$(basename "$client_dir")
        emit "add client-${client_name} -t component -m path=\"${client_dir}\" type=\"api-client\""
        emit "link ${REPO_NAME} contains client-${client_name}"
      fi
    done
  fi

  # Scan workflows (Medusa v2)
  if [ -d "src/workflows" ]; then
    echo "${GREEN}Found src/workflows/${RESET}"
    for wf_dir in src/workflows/*/; do
      if [ -d "$wf_dir" ]; then
        wf_name=$(basename "$wf_dir")
        emit "add wf-${wf_name} -t component -m path=\"${wf_dir}\" type=\"workflow\""
        emit "link ${REPO_NAME} contains wf-${wf_name}"
      fi
    done
  fi
fi

# --- Monorepo: scan packages/ or apps/ ---
for mono_dir in packages apps; do
  if [ -d "$mono_dir" ]; then
    echo "${GREEN}Found ${mono_dir}/${RESET}"
    for pkg_dir in "$mono_dir"/*/; do
      if [ -d "$pkg_dir" ] && [ -f "$pkg_dir/package.json" ]; then
        pkg_name=$(basename "$pkg_dir")
        pkg_desc=$(python3 -c "import json; d=json.load(open('${pkg_dir}/package.json')); print(d.get('description',''))" 2>/dev/null || echo "")
        emit "add ${pkg_name} -t module -m description=\"${pkg_desc}\" path=\"${pkg_dir}\""
        emit "link ${REPO_NAME} contains ${pkg_name}"
      fi
    done
  fi
done

# --- Count results ---
NODE_COUNT=$(grep "^add " "$BATCH_FILE" | wc -l | tr -d ' ')
EDGE_COUNT=$(grep "^link " "$BATCH_FILE" | wc -l | tr -d ' ')

echo ""
echo "${BOLD}Generated: ${NODE_COUNT} nodes, ${EDGE_COUNT} edges${RESET}"
echo "${DIM}Batch file: ${BATCH_FILE}${RESET}"
echo ""

if [ "$DRY_RUN" = "--dry-run" ]; then
  echo "${YELLOW}--- DRY RUN (batch commands) ---${RESET}"
  cat "$BATCH_FILE"
  echo "${YELLOW}--- END DRY RUN ---${RESET}"
  echo ""
  echo "To import: cd ~/Personal/engram && npx tsx src/index.ts batch ${MODEL} < ${BATCH_FILE}"
else
  echo "To import: cd ~/Personal/engram && npx tsx src/index.ts batch ${MODEL} < ${BATCH_FILE}"
  echo "To preview first: cat ${BATCH_FILE}"
fi
