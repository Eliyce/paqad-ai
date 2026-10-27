import unittest


class T(unittest.TestCase):
    @unittest.expectedFailure
    def test_b(self):
        self.assertEqual(1, 2)
