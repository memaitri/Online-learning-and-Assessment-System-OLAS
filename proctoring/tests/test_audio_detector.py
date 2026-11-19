import unittest
from unittest.mock import patch

from audio_detection.audio_detector import _resolve_input_device


class FakePyAudio:
    def __init__(self, devices, default_index):
        self.devices = devices
        self.default_index = default_index

    def get_default_input_device_info(self):
        return self.devices[self.default_index]

    def get_device_count(self):
        return len(self.devices)

    def get_device_info_by_index(self, index):
        return self.devices[index]


class ResolveInputDeviceTests(unittest.TestCase):
    def setUp(self):
        self.devices = [
            {"index": 0, "name": "Microsoft Sound Mapper - Input", "maxInputChannels": 2},
            {"index": 1, "name": "Line 1 (Virtual Audio Cable)", "maxInputChannels": 2},
            {"index": 2, "name": "Microphone (Realtek Audio)", "maxInputChannels": 2},
            {"index": 3, "name": "Speakers", "maxInputChannels": 0},
        ]

    def test_virtual_default_uses_available_physical_microphone(self):
        pa = FakePyAudio(self.devices, default_index=1)

        with patch("builtins.print"):
            result = _resolve_input_device(pa, requested_index=None)

        self.assertEqual(result, 2)

    def test_explicit_device_index_is_preserved(self):
        pa = FakePyAudio(self.devices, default_index=1)

        self.assertEqual(_resolve_input_device(pa, requested_index=2), 2)

    def test_physical_system_default_is_preserved(self):
        pa = FakePyAudio(self.devices, default_index=2)

        self.assertEqual(_resolve_input_device(pa, requested_index=None), 2)


if __name__ == "__main__":
    unittest.main()
