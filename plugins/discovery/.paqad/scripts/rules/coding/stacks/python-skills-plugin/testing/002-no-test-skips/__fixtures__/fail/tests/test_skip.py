import unittest


class T(unittest.TestCase):
    @unittest.skip("later")
    def test_a(self):
        self.assertEqual(1, 1)
