#!/usr/bin/env python3
"""Pack the ChatGPT directory package into the submission zip (CI-16).

Standard library only (Python 3.9+). No network. Reads the built native package at
dist/hosts/chatgpt-directory/plugins/<name> (run build/build.py first) and writes one zip that
holds exactly that plugin root under a single top-level folder named after the plugin, with no
sibling file, which is the one-plugin-root shape the directory accepts. Nothing outside the package
folder is packed, and dist/ never holds a zip: packing lives outside build.build().

The archive is deterministic for one Python and zlib build: entries sorted by archive path, an
explicit entry for every folder, a fixed 1980-01-01 timestamp, fixed Unix modes and fixed
compression. A symlink or any entry that is not a regular file or folder stops the run; .DS_Store,
__pycache__/ and *.pyc are skipped.

CLI:
  package_chatgpt.py [--dist DIR] [--out FILE]

Prints the zip path and exits 0; exits 1 with a one-line message on stderr on any error.
"""

import argparse
import os
import stat
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import build  # noqa: E402

ZIP_DATE_TIME = (1980, 1, 1, 0, 0, 0)
ZIP_CREATE_SYSTEM = 3
FILE_EXTERNAL_ATTR = 0o100644 << 16
DIR_EXTERNAL_ATTR = (0o040755 << 16) | 0x10
COMPRESS_LEVEL = 9
SKIPPED_DIR_NAMES = ("__pycache__",)


class PackageError(Exception):
    """Raised when the package cannot be packed; carries a one-line message."""


def is_skipped(name, is_dir):
    """True for OS and build cruft that never ships: .DS_Store, __pycache__/ and *.pyc."""
    if is_dir:
        return name in SKIPPED_DIR_NAMES
    return name in build.SKIPPED_FILE_NAMES or name.endswith(".pyc")


def default_package_dir(dist_root, config):
    """The built ChatGPT directory plugin root inside dist_root."""
    branch_root = os.path.join(dist_root, build.HOSTS_DIR, build.CHATGPT_DIRECTORY_HOST)
    return build.plugin_dir_path(branch_root, config["name"])


def default_zip_name(config):
    return "{0}-chatgpt-v{1}.zip".format(config["name"], config["version"])


def _refuse(path, mode):
    if stat.S_ISLNK(mode):
        raise PackageError(
            "{0} is a symlink; the directory zip allows regular files and folders only".format(path)
        )
    raise PackageError(
        "{0} is not a regular file or folder; the directory zip allows regular files and "
        "folders only".format(path)
    )


def collect_entries(package_dir):
    """Return sorted (archive path, filesystem path or None for a folder) for the package."""
    if not os.path.isdir(package_dir):
        raise PackageError(
            "ChatGPT directory package not found at {0}; run python3 build/build.py "
            "first".format(package_dir)
        )
    top = os.path.basename(os.path.normpath(package_dir))
    entries = [(top + "/", None)]
    for dirpath, dirnames, filenames in os.walk(package_dir):
        rel = os.path.relpath(dirpath, package_dir)
        prefix = top + "/" if rel == "." else "{0}/{1}/".format(top, rel.replace(os.sep, "/"))
        kept = []
        for name in sorted(dirnames):
            if is_skipped(name, True):
                continue
            full = os.path.join(dirpath, name)
            mode = os.lstat(full).st_mode
            if not stat.S_ISDIR(mode):
                _refuse(full, mode)
            kept.append(name)
            entries.append((prefix + name + "/", None))
        dirnames[:] = kept
        for name in sorted(filenames):
            if is_skipped(name, False):
                continue
            full = os.path.join(dirpath, name)
            mode = os.lstat(full).st_mode
            if not stat.S_ISREG(mode):
                _refuse(full, mode)
            entries.append((prefix + name, full))
    return sorted(entries)


def make_zip(package_dir, zip_path):
    """Write the deterministic submission zip of package_dir to zip_path and return zip_path."""
    entries = collect_entries(package_dir)
    parent = os.path.dirname(os.path.abspath(zip_path))
    os.makedirs(parent, exist_ok=True)
    with zipfile.ZipFile(zip_path, "w") as archive:
        for arcname, source in entries:
            info = zipfile.ZipInfo(arcname, date_time=ZIP_DATE_TIME)
            info.create_system = ZIP_CREATE_SYSTEM
            if source is None:
                info.external_attr = DIR_EXTERNAL_ATTR
                info.compress_type = zipfile.ZIP_STORED
                archive.writestr(info, b"")
                continue
            info.external_attr = FILE_EXTERNAL_ATTR
            with open(source, "rb") as handle:
                data = handle.read()
            archive.writestr(
                info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=COMPRESS_LEVEL
            )
    return zip_path


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Pack dist/hosts/chatgpt-directory/plugins/<name> into the ChatGPT "
        "directory submission zip."
    )
    parser.add_argument("--dist", default=os.path.join(REPO_ROOT, "dist"),
                        help="built dist root (default <repo>/dist)")
    parser.add_argument("--out", default=None,
                        help="zip to write (default <repo>/<name>-chatgpt-v<version>.zip)")
    args = parser.parse_args(argv)
    try:
        config = build.load_config(os.path.join(REPO_ROOT, "build", "skills.yml"))
        out = args.out or os.path.join(REPO_ROOT, default_zip_name(config))
        make_zip(default_package_dir(args.dist, config), out)
    except (build.BuildError, PackageError) as exc:
        sys.stderr.write("{0}\n".format(exc))
        return 1
    sys.stdout.write("{0}\n".format(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
