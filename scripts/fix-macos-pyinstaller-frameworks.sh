#!/usr/bin/env bash
set -euo pipefail

backend_dir="${1:-}"

if [ -z "$backend_dir" ]; then
  echo "Usage: scripts/fix-macos-pyinstaller-frameworks.sh <app-backend-dir>" >&2
  exit 1
fi

if [ ! -d "$backend_dir" ]; then
  echo "Backend directory does not exist: $backend_dir" >&2
  exit 1
fi

find "$backend_dir" -type d -name "*.framework" -print | while IFS= read -r framework_path; do
  framework_name="$(basename "$framework_path" .framework)"
  versions_dir="$framework_path/Versions"

  if [ ! -d "$versions_dir" ]; then
    continue
  fi

  framework_version=""
  for candidate in "$versions_dir"/*; do
    if [ -d "$candidate" ] && [ "$(basename "$candidate")" != "Current" ]; then
      framework_version="$(basename "$candidate")"
      break
    fi
  done

  if [ -z "$framework_version" ]; then
    echo "Could not find a concrete framework version in $versions_dir" >&2
    exit 1
  fi

  version_dir="$versions_dir/$framework_version"
  framework_binary="$version_dir/$framework_name"
  if [ ! -f "$framework_binary" ]; then
    echo "Framework binary does not exist: $framework_binary" >&2
    exit 1
  fi

  echo "Repairing framework symlinks: $framework_path"
  rm -rf "$framework_path/_CodeSignature"

  if [ -e "$versions_dir/Current" ] && [ ! -L "$versions_dir/Current" ]; then
    rm -rf "$versions_dir/Current"
  fi
  if [ -L "$versions_dir/Current" ] && [ "$(readlink "$versions_dir/Current")" != "$framework_version" ]; then
    rm "$versions_dir/Current"
  fi
  if [ ! -e "$versions_dir/Current" ] && [ ! -L "$versions_dir/Current" ]; then
    (cd "$versions_dir" && ln -s "$framework_version" Current)
  fi

  for version_entry in "$version_dir"/*; do
    entry_name="$(basename "$version_entry")"
    top_level_entry="$framework_path/$entry_name"

    if [ -e "$top_level_entry" ] && [ ! -L "$top_level_entry" ]; then
      rm -rf "$top_level_entry"
    fi
    if [ -L "$top_level_entry" ] && [ "$(readlink "$top_level_entry")" != "Versions/Current/$entry_name" ]; then
      rm "$top_level_entry"
    fi
    if [ ! -e "$top_level_entry" ] && [ ! -L "$top_level_entry" ]; then
      (cd "$framework_path" && ln -s "Versions/Current/$entry_name" "$entry_name")
    fi
  done
done

python_framework="$backend_dir/_internal/Python.framework"
python_link="$backend_dir/_internal/Python"
if [ -d "$python_framework" ]; then
  if [ -e "$python_link" ] && [ ! -L "$python_link" ]; then
    rm -f "$python_link"
  fi
  if [ -L "$python_link" ] && [ "$(readlink "$python_link")" != "Python.framework/Versions/Current/Python" ]; then
    rm "$python_link"
  fi
  if [ ! -e "$python_link" ] && [ ! -L "$python_link" ]; then
    (cd "$backend_dir/_internal" && ln -s "Python.framework/Versions/Current/Python" Python)
  fi
fi
