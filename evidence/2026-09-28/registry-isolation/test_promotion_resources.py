import copy
import unittest
import promote
class ResourceAcceptanceTests(unittest.TestCase):
    def test_exact_profile_accepted(self):
        promote.validate_resources({'resources': copy.deepcopy(promote.EXPECTED_RESOURCES)})
    def test_different_guarantees_and_limits_rejected(self):
        for group, key, value in [('requests','memory','2Gi'),('requests','ephemeral-storage','2Gi'),('requests','cpu','500m'),('limits','memory','4Gi'),('limits','ephemeral-storage','4Gi'),('limits','cpu','4')]:
            with self.subTest(group=group,key=key):
                resources=copy.deepcopy(promote.EXPECTED_RESOURCES);resources[group][key]=value
                with self.assertRaisesRegex(RuntimeError,'resources differ'):
                    promote.validate_resources({'resources':resources})
    def test_missing_profile_rejected(self):
        with self.assertRaisesRegex(RuntimeError,'resources differ'):
            promote.validate_resources({})
if __name__=='__main__':unittest.main()
