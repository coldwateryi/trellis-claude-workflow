#!/usr/bin/env bash

if [ -n "${BASH_VERSION:-}" ]; then
  if shopt -oq posix 2>/dev/null; then
    printf '%s\n' 'ERROR: install-trellis-workflows.sh was started in POSIX sh mode.' >&2
    printf '%s\n' 'This installer supports bash and zsh only. Run with one of:' >&2
    printf '%s\n' '  bash scripts/install-trellis-workflows.sh --project-dir /path/to/trellis-project' >&2
    printf '%s\n' '  zsh scripts/install-trellis-workflows.sh --project-dir /path/to/trellis-project' >&2
    exit 1
  fi
elif [ -n "${ZSH_VERSION:-}" ]; then
  :
else
  printf '%s\n' 'ERROR: install-trellis-workflows.sh only supports bash and zsh.' >&2
  printf '%s\n' 'Run with one of:' >&2
  printf '%s\n' '  bash scripts/install-trellis-workflows.sh --project-dir /path/to/trellis-project' >&2
  printf '%s\n' '  zsh scripts/install-trellis-workflows.sh --project-dir /path/to/trellis-project' >&2
  exit 1
fi

set -eu

WORKFLOW_FILES="trellis-parallel-implement.js trellis-parallel-research.js trellis-dag-implement.js"
REPO_URL="${TRELLIS_WORKFLOW_REPO_URL:-https://github.com/coldwateryi/trellis-claude-workflow}"
BRANCH="${TRELLIS_WORKFLOW_BRANCH:-main}"

log_timestamp() {
  date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || printf '%s' 'unknown-time'
}

log_message() {
  level="$1"
  shift
  printf '[trellis-workflows][%s][%s] %s\n' "$(log_timestamp)" "$level" "$*" >&2
}

log() {
  log_message INFO "$@"
}

warn() {
  log_message WARN "$@"
}

die() {
  log_message ERROR "$@"
  exit 1
}

shell_summary() {
  if [ -n "${BASH_VERSION:-}" ]; then
    printf 'bash %s' "$BASH_VERSION"
  elif [ -n "${ZSH_VERSION:-}" ]; then
    printf 'zsh %s' "$ZSH_VERSION"
  else
    printf 'unknown'
  fi
}

usage() {
  printf '%s\n' "Usage: bash scripts/install-trellis-workflows.sh [--project-dir DIR]"
  printf '%s\n' "       zsh  scripts/install-trellis-workflows.sh [--project-dir DIR]"
  printf '%s\n' "       curl -fsSL .../install-trellis-workflows.sh | bash -s -- [--project-dir DIR]"
  printf '%s\n' ""
  printf '%s\n' "Options:"
  printf '%s\n' "  --source-dir DIR   Use workflow files from a local clone directory."
  printf '%s\n' "  --online           Force GitHub archive download instead of local source detection."
  printf '%s\n' "  --project-dir DIR  Trellis-initialized project directory to install into."
  printf '%s\n' "  --global           Install into the global Claude workflows directory."
  printf '%s\n' "  --yes, -y          Accept global install prompt when no Trellis project is selected."
  printf '%s\n' "  --target-dir DIR   Advanced: install directly into this directory."
  printf '%s\n' "  --repo-url URL     GitHub repository URL. Default: $REPO_URL"
  printf '%s\n' "  --repo OWNER/REPO  GitHub repository shorthand."
  printf '%s\n' "  --branch REF       Branch, tag, or commit archive ref. Default: $BRANCH"
  printf '%s\n' "  --ref REF          Alias for --branch."
  printf '%s\n' "  -h, --help         Show this help."
  printf '%s\n' ""
  printf '%s\n' "Environment:"
  printf '%s\n' "  TRELLIS_WORKFLOW_SOURCE_DIR   Default local source directory."
  printf '%s\n' "  TRELLIS_WORKFLOW_REPO_URL     Default GitHub repository URL."
  printf '%s\n' "  TRELLIS_WORKFLOW_BRANCH       Default branch, tag, or commit."
  printf '%s\n' "  TRELLIS_WORKFLOW_PROJECT_DIR  Default Trellis project directory."
  printf '%s\n' "  TRELLIS_WORKFLOW_INSTALL_DIR  Direct target directory override."
}

read_line() {
  if [ -r /dev/tty ]; then
    if IFS= read -r "$1" 2>/dev/null </dev/tty; then
      return 0
    fi
  fi

  IFS= read -r "$1"
}

resolve_dir() {
  [ -d "$1" ] || return 1
  (cd "$1" && pwd -P)
}

is_trellis_project() {
  [ -d "$1/.trellis" ]
}

is_workflow_source() {
  [ -d "$1/scripts" ] || return 1

  for workflow_file in $WORKFLOW_FILES; do
    [ -f "$1/$workflow_file" ] || return 1
  done

  return 0
}

detect_local_source_dir() {
  if [ "${TRELLIS_WORKFLOW_SOURCE_DIR:-}" ]; then
    source_dir="$(resolve_dir "$TRELLIS_WORKFLOW_SOURCE_DIR" 2>/dev/null || true)"
    [ -n "$source_dir" ] && is_workflow_source "$source_dir" && {
      printf '%s\n' "$source_dir"
      return 0
    }
    die "TRELLIS_WORKFLOW_SOURCE_DIR is not a workflow source directory: $TRELLIS_WORKFLOW_SOURCE_DIR"
  fi

  current_dir="$(pwd -P)"
  if is_workflow_source "$current_dir"; then
    printf '%s\n' "$current_dir"
    return 0
  fi

  if [ "${current_dir##*/}" = "scripts" ]; then
    parent_dir="$(resolve_dir "$current_dir/.." 2>/dev/null || true)"
    if [ -n "$parent_dir" ] && is_workflow_source "$parent_dir"; then
      printf '%s\n' "$parent_dir"
      return 0
    fi
  fi

  case "$0" in
    */*)
      script_parent="$(dirname "$0")"
      script_dir="$(resolve_dir "$script_parent" 2>/dev/null || true)"
      if [ -n "$script_dir" ] && [ "${script_dir##*/}" = "scripts" ]; then
        parent_dir="$(resolve_dir "$script_dir/.." 2>/dev/null || true)"
        if [ -n "$parent_dir" ] && is_workflow_source "$parent_dir"; then
          printf '%s\n' "$parent_dir"
          return 0
        fi
      fi
      ;;
  esac

  return 1
}

find_workflow_source_in_dir() {
  search_root="$1"
  found_dir=""

  while IFS= read -r candidate_dir; do
    [ "$candidate_dir" = "$search_root" ] && continue
    if is_workflow_source "$candidate_dir"; then
      found_dir="$candidate_dir"
      break
    fi
  done <<EOF
$(find "$search_root" -maxdepth 1 -type d)
EOF

  [ -n "$found_dir" ] || return 1
  printf '%s\n' "$found_dir"
}

claude_global_workflows_root() {
  [ -n "${HOME:-}" ] || die 'Unable to determine global Claude workflow directory. Set HOME.'
  printf '%s/.claude/workflows\n' "$HOME"
}

choose_global_install() {
  checked_dir="$1"

  if [ "$install_global" = "1" ] || [ "$assume_yes" = "1" ]; then
    return 0
  fi

  while :; do
    printf 'Directory %s is not a Trellis project. Install globally instead? [y/N]: ' "$checked_dir" >&2
    read_line answer || die 'Could not read global install choice. Run in an interactive terminal or pass --global.'

    case "$answer" in
      Y|y|Yes|yes|YES|是)
        return 0
        ;;
      ''|N|n|No|no|NO|否)
        return 1
        ;;
      *)
        warn 'Please enter y/yes/是 or n/no/否.'
        ;;
    esac
  done
}

prompt_trellis_project_dir() {
  while :; do
    printf 'Enter a Trellis-initialized project directory: ' >&2
    read_line input_dir || die 'Could not read project directory. Run in an interactive terminal or pass --project-dir.'

    [ -n "$input_dir" ] || {
      warn 'Project directory cannot be empty.'
      continue
    }

    resolved_dir="$(resolve_dir "$input_dir" 2>/dev/null || true)"
    [ -n "$resolved_dir" ] || {
      warn "Directory does not exist: $input_dir"
      continue
    }

    if is_trellis_project "$resolved_dir"; then
      log "Selected Trellis project directory: $resolved_dir"
      printf 'project|%s\n' "$resolved_dir"
      return 0
    fi

    warn "No .trellis/ directory found. path=$resolved_dir"
    if choose_global_install "$resolved_dir"; then
      log 'User selected global workflow install.'
      printf 'global|\n'
      return 0
    fi

    warn 'Run trellis init first, or enter another initialized Trellis project directory.'
  done
}

resolve_install_target() {
  if [ -n "$target_dir" ]; then
    printf 'direct|%s\n' "$target_dir"
    return 0
  fi

  if [ "${TRELLIS_WORKFLOW_INSTALL_DIR:-}" ]; then
    printf 'direct|%s\n' "$TRELLIS_WORKFLOW_INSTALL_DIR"
    return 0
  fi

  if [ "$install_global" = "1" ]; then
    printf 'global|\n'
    return 0
  fi

  if [ -z "$project_dir" ] && [ "${TRELLIS_WORKFLOW_PROJECT_DIR:-}" ]; then
    project_dir="$TRELLIS_WORKFLOW_PROJECT_DIR"
  fi

  if [ -n "$project_dir" ]; then
    resolved_dir="$(resolve_dir "$project_dir" 2>/dev/null || true)"
    [ -n "$resolved_dir" ] || die "Project directory does not exist: $project_dir"

    if is_trellis_project "$resolved_dir"; then
      printf 'project|%s\n' "$resolved_dir"
      return 0
    fi

    warn "Specified project directory is not a Trellis project. path=$resolved_dir"
    if choose_global_install "$resolved_dir"; then
      printf 'global|\n'
      return 0
    fi

    prompt_trellis_project_dir
    return 0
  fi

  current_dir="$(pwd -P)"
  if is_trellis_project "$current_dir"; then
    log "Current directory is a Trellis project: $current_dir"
    printf 'project|%s\n' "$current_dir"
    return 0
  fi

  warn "Current directory is not a Trellis project. cwd=$current_dir"
  prompt_trellis_project_dir
}

download_archive() {
  archive_url="$REPO_URL/archive/$BRANCH.tar.gz"
  archive_path="$1"
  log "Preparing GitHub archive download. url=$archive_url output=$archive_path"

  if command -v curl >/dev/null 2>&1; then
    log 'Using curl to download GitHub archive.'
    curl -fsSL "$archive_url" -o "$archive_path"
  elif command -v wget >/dev/null 2>&1; then
    log 'Using wget to download GitHub archive.'
    wget -qO "$archive_path" "$archive_url"
  else
    die 'curl or wget is required to download the GitHub archive.'
  fi
}

copy_workflows_to_install_root() {
  source_dir="$1"
  install_root="$2"

  log "Preparing workflow install. source_dir=$source_dir install_root=$install_root"
  mkdir -p "$install_root"

  for workflow_file in $WORKFLOW_FILES; do
    source_file="$source_dir/$workflow_file"
    target_file="$install_root/$workflow_file"

    [ -f "$source_file" ] || die "Workflow source file is missing: $source_file"

    cp "$source_file" "$target_file"
    log "Installed $workflow_file -> $target_file"
  done
}

project_dir=""
target_dir=""
source_dir=""
install_global=0
assume_yes=0
force_online=0
tmp_dir=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-dir)
      [ "$#" -ge 2 ] || die '--source-dir requires a value.'
      source_dir="$2"
      shift 2
      ;;
    --online)
      force_online=1
      shift
      ;;
    --project-dir)
      [ "$#" -ge 2 ] || die '--project-dir requires a value.'
      project_dir="$2"
      shift 2
      ;;
    --target-dir)
      [ "$#" -ge 2 ] || die '--target-dir requires a value.'
      target_dir="$2"
      shift 2
      ;;
    --global)
      install_global=1
      shift
      ;;
    --yes|-y)
      assume_yes=1
      shift
      ;;
    --repo-url)
      [ "$#" -ge 2 ] || die '--repo-url requires a value.'
      REPO_URL="$2"
      shift 2
      ;;
    --repo)
      [ "$#" -ge 2 ] || die '--repo requires a value.'
      REPO_URL="https://github.com/$2"
      shift 2
      ;;
    --branch|--ref)
      [ "$#" -ge 2 ] || die "$1 requires a value."
      BRANCH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

cleanup() {
  if [ -n "$tmp_dir" ]; then
    log "Cleaning temporary directory: $tmp_dir"
    rm -rf "$tmp_dir"
  fi
}
trap cleanup EXIT INT TERM

log "Starting installer. shell=$(shell_summary) pid=$$ cwd=$(pwd -P)"

target_spec="$(resolve_install_target)"
install_scope="${target_spec%%|*}"
install_base="${target_spec#*|}"

case "$install_scope" in
  project)
    install_root="$install_base/.claude/workflows"
    ;;
  global)
    install_root="$(claude_global_workflows_root)"
    ;;
  direct)
    install_root="$install_base"
    ;;
  *)
    die "Unknown install scope: $install_scope"
    ;;
esac

if [ -n "$source_dir" ]; then
  resolved_source_dir="$(resolve_dir "$source_dir" 2>/dev/null || true)"
  [ -n "$resolved_source_dir" ] || die "Source directory does not exist: $source_dir"
  is_workflow_source "$resolved_source_dir" || die "Source directory is not a workflow template source: $resolved_source_dir"
  source_dir="$resolved_source_dir"
  log "Using explicit local workflow source directory: $source_dir"
elif [ "$force_online" != "1" ]; then
  source_dir="$(detect_local_source_dir 2>/dev/null || true)"
  if [ -n "$source_dir" ]; then
    log "Using detected local workflow source directory: $source_dir"
  fi
fi

if [ -z "$source_dir" ]; then
  tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t trellis-workflows)"
  archive_path="$tmp_dir/trellis-workflows.tar.gz"
  log "No local workflow source detected. Downloading remote source. repo_url=$REPO_URL branch=$BRANCH"
  download_archive "$archive_path"

  log "Extracting archive. archive=$archive_path tmp_dir=$tmp_dir"
  tar -xzf "$archive_path" -C "$tmp_dir"
  source_dir="$(find_workflow_source_in_dir "$tmp_dir" 2>/dev/null || true)"
  [ -n "$source_dir" ] || die 'Could not locate extracted trellis-claude-workflow source directory.'
  log "Located extracted source directory: $source_dir"
fi

copy_workflows_to_install_root "$source_dir" "$install_root"
log "Trellis workflow templates installed to: $install_root"
