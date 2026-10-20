"""Real archive/metadata boundary tests; no Android process is started."""
import hashlib
import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
import zipfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((HERE / "bootstrap.py").is_file(), "Linux bootstrap is missing")
        spec = importlib.util.spec_from_file_location("bootstrap", HERE / "bootstrap.py")
        self.runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.runtime)

    def test_corrupt_same_size_archive_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "test.zip"
            path.write_bytes(b"wrong")
            expected = {"sizeBytes": 5, "checksumAlgorithm": "sha1", "checksum": hashlib.sha1(b"right").hexdigest()}
            with self.assertRaisesRegex(ValueError, "checksum"):
                self.runtime.verify_archive(path, expected)

    def test_rejects_traversal_before_writing_any_file(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "test.zip"
            target = Path(directory) / "stage"
            with zipfile.ZipFile(archive, "w") as content:
                content.writestr("emulator/valid", "first")
                content.writestr("emulator/../../escape", "unsafe")
            with self.assertRaisesRegex(ValueError, "Unsafe"):
                self.runtime.extract_archive(archive, target, "emulator", reserve_bytes=0)
            self.assertFalse((target / "emulator/valid").exists())
            self.assertFalse((Path(directory) / "escape").exists())

    def test_extracts_executable_and_safe_internal_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "test.zip"
            target = Path(directory) / "stage"
            with zipfile.ZipFile(archive, "w") as content:
                executable = zipfile.ZipInfo("emulator/bin/tool")
                executable.external_attr = (stat.S_IFREG | 0o755) << 16
                content.writestr(executable, "verified bytes")
                link = zipfile.ZipInfo("emulator/tool")
                link.external_attr = (stat.S_IFLNK | 0o777) << 16
                content.writestr(link, "bin/tool")
            self.runtime.extract_archive(archive, target, "emulator", reserve_bytes=0)
            self.assertEqual((target / "emulator/tool").read_text(), "verified bytes")
            self.assertTrue((target / "emulator/bin/tool").stat().st_mode & stat.S_IXUSR)

    def test_rejects_symlink_escape_and_write_through_link(self):
        for filename, link_target, child in [("emulator/link", "../../escape", None), ("emulator/link", "bin", "emulator/link/child")]:
            with self.subTest(link=link_target), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / "test.zip"
                with zipfile.ZipFile(archive, "w") as content:
                    link = zipfile.ZipInfo(filename)
                    link.external_attr = (stat.S_IFLNK | 0o777) << 16
                    content.writestr(link, link_target)
                    if child:
                        content.writestr(child, "unsafe")
                with self.assertRaisesRegex(ValueError, "Unsafe"):
                    self.runtime.extract_archive(archive, Path(directory) / "stage", "emulator", reserve_bytes=0)

    def test_readback_rejects_wrong_installed_revision(self):
        packages = [{"path": "emulator", "revision": "37.2.12"}]
        with self.assertRaisesRegex(ValueError, "SDK Manager"):
            self.runtime.check_installed_listing("emulator | 37.2.11 | Android Emulator | emulator/", packages)
        self.runtime.check_installed_listing("emulator | 37.2.12 | Android Emulator | emulator/", packages)

    def test_rejects_composed_symlink_escape_and_cycles(self):
        cases = [[("emulator/n/a", ".."), ("emulator/b", "n/a/../outside")],
                 [("emulator/a", "b"), ("emulator/b", "a")]]
        for links in cases:
            with self.subTest(links=links), tempfile.TemporaryDirectory() as directory:
                archive = Path(directory) / "test.zip"
                with zipfile.ZipFile(archive, "w") as content:
                    for filename, target in links:
                        link = zipfile.ZipInfo(filename)
                        link.external_attr = (stat.S_IFLNK | 0o777) << 16
                        content.writestr(link, target)
                with self.assertRaisesRegex(ValueError, "Unsafe"):
                    self.runtime.extract_archive(archive, Path(directory) / "stage", "emulator", reserve_bytes=0)

    def test_generic_metadata_registers_exact_package_identity_and_license(self):
        document = b'''<sdk:sdk-repository xmlns:sdk="http://schemas.android.com/sdk/android/repo/repository2/03"
            xmlns:generic="http://schemas.android.com/repository/android/generic/02"
            xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
          <license id="android-sdk-license" type="text">Accepted terms</license>
          <remotePackage path="cmdline-tools;22.0">
            <type-details xsi:type="generic:genericDetailsType"/>
            <revision><major>22</major><minor>0</minor></revision>
            <display-name>Android SDK Command-line Tools</display-name>
            <uses-license ref="android-sdk-license"/><channelRef ref="channel-0"/>
            <archives><archive><complete><url>archive.zip</url></complete></archive></archives>
          </remotePackage>
        </sdk:sdk-repository>'''
        package = {"path": "cmdline-tools;22.0", "revision": "22.0", "licenseId": "android-sdk-license"}
        license_pin = {"id": "android-sdk-license", "textSha256": hashlib.sha256(b"Accepted terms").hexdigest()}
        self.assertTrue(callable(getattr(self.runtime, "local_package_metadata", None)), "Missing generic package metadata registration")
        xml = self.runtime.local_package_metadata(package, document, license_pin)
        root = ET.fromstring(xml)
        local = root.find("localPackage")
        self.assertEqual(local.get("path"), "cmdline-tools;22.0")
        self.assertEqual(local.findtext("revision/major"), "22")
        self.assertEqual(local.findtext("revision/minor"), "0")
        self.assertEqual(local.find("uses-license").get("ref"), "android-sdk-license")
        self.assertEqual(root.findtext("license"), "Accepted terms")
        self.assertIsNone(local.find("archives"))
        self.assertIsNone(local.find("channelRef"))
        with self.assertRaisesRegex(ValueError, "revision"):
            self.runtime.local_package_metadata({**package, "revision": "21.0"}, document, license_pin)
        with self.assertRaisesRegex(ValueError, "license"):
            self.runtime.local_package_metadata(package, document.replace(b"Accepted terms", b"Changed terms"), license_pin)

    def test_partial_live_listing_stays_rejected_until_both_generic_packages_appear(self):
        # Actual failed Linux listing contained only these two legacy-recognized packages.
        partial = "platform-tools | 37.0.1 | Android SDK Platform-Tools | platform-tools/\n" + \
            "system-images;android-35;google_apis_playstore;x86_64 | 9 | Google Play Intel x86_64 Atom System Image | system-images/android-35/google_apis_playstore/x86_64/\n"
        with self.assertRaisesRegex(ValueError, "cmdline-tools;22.0"):
            self.runtime.check_installed_listing(partial, self.runtime.LOCK["packages"])
        with_tools = partial + "cmdline-tools;22.0 | 22.0 | Android SDK Command-line Tools | cmdline-tools/22.0/\n"
        with self.assertRaisesRegex(ValueError, "emulator"):
            self.runtime.check_installed_listing(with_tools, self.runtime.LOCK["packages"])
        self.runtime.check_installed_listing(with_tools + "emulator | 37.2.12 | Android Emulator | emulator/\n", self.runtime.LOCK["packages"])


if __name__ == "__main__":
    unittest.main()
