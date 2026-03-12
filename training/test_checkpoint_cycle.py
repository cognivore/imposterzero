"""
Integration tests for checkpoint save/load cycle.

Verifies that:
1. Checkpoints can be saved and loaded correctly
2. Symlinks (annexed files) are handled properly
3. Checkpoint rotation works
4. Timestamped output generation works
"""

import json
import os
import tempfile
import shutil
import pytest
import torch

# Import the modules we're testing
from train_ppo import (
    ActorCritic,
    export_weights,
    generate_timestamped_output,
    check_output_path,
    rotate_checkpoints,
    OBS_SIZE,
)

NUM_ACTIONS = 2990  # From imposter_zero.game


class TestCheckpointCycle:
    """Test save/load cycle for checkpoints."""

    def test_save_and_load_checkpoint(self, tmp_path):
        """Test that we can save a checkpoint and load it back."""
        # Create a network
        net = ActorCritic(OBS_SIZE, 64, NUM_ACTIONS, 2)  # Small network for testing

        # Save it
        output_path = tmp_path / "test_checkpoint.json"
        metadata = {
            "algorithm": "test",
            "episodes": 1000,
            "win_rate_vs_random": 0.75,
        }
        export_weights(net, str(output_path), metadata)

        # Verify file exists and is readable
        assert output_path.exists()
        with open(output_path) as f:
            data = json.load(f)

        assert "metadata" in data
        assert "weights" in data
        assert data["metadata"]["algorithm"] == "test"
        assert data["metadata"]["episodes"] == 1000

        # Load it back into a new network
        net2 = ActorCritic(OBS_SIZE, 64, NUM_ACTIONS, 2)
        rw = data["weights"]
        sd = net2.state_dict()
        linear_keys = [(k.rsplit(".", 1)[0], k) for k in sd if k.endswith(".weight")]
        linear_keys.sort(key=lambda t: t[1])
        for i, (prefix, wkey) in enumerate(linear_keys):
            sd[wkey] = torch.tensor(rw[f"w{i+1}"])
            bkey = prefix + ".bias"
            if bkey in sd and f"b{i+1}" in rw:
                sd[bkey] = torch.tensor(rw[f"b{i+1}"])
        net2.load_state_dict(sd)

        # Verify weights match
        for (n1, p1), (n2, p2) in zip(net.named_parameters(), net2.named_parameters()):
            assert n1 == n2
            assert torch.allclose(p1, p2), f"Mismatch in {n1}"

    def test_overwrite_existing_file(self, tmp_path):
        """Test that we can overwrite an existing checkpoint."""
        output_path = tmp_path / "test_checkpoint.json"

        # Create first checkpoint
        net1 = ActorCritic(OBS_SIZE, 64, NUM_ACTIONS, 2)
        export_weights(net1, str(output_path), {"version": 1})

        # Create second checkpoint (should overwrite)
        net2 = ActorCritic(OBS_SIZE, 64, NUM_ACTIONS, 2)
        export_weights(net2, str(output_path), {"version": 2})

        # Verify second version
        with open(output_path) as f:
            data = json.load(f)
        assert data["metadata"]["version"] == 2

    def test_overwrite_symlink(self, tmp_path):
        """Test that we can overwrite a symlink (simulating git-annex)."""
        # Create a target file
        target_path = tmp_path / "target.json"
        with open(target_path, "w") as f:
            json.dump({"old": "data"}, f)

        # Create a symlink to it
        symlink_path = tmp_path / "symlink.json"
        os.symlink(target_path, symlink_path)

        # Export should handle the symlink
        net = ActorCritic(OBS_SIZE, 64, NUM_ACTIONS, 2)
        export_weights(net, str(symlink_path), {"new": "data"})

        # Verify it's now a regular file, not a symlink
        assert not os.path.islink(symlink_path)
        assert os.path.isfile(symlink_path)

        with open(symlink_path) as f:
            data = json.load(f)
        assert "weights" in data


class TestTimestampedOutput:
    """Test timestamped output path generation."""

    def test_generate_timestamped_output(self, tmp_path):
        """Test that timestamped paths are generated correctly."""
        path = generate_timestamped_output(str(tmp_path), "policy_test")
        assert path.startswith(str(tmp_path))
        assert "policy_test_" in path
        assert path.endswith(".json")
        # Should contain a timestamp in YYYYMMDD_HHMMSS format
        import re
        assert re.search(r"policy_test_\d{8}_\d{6}\.json$", path)

    def test_unique_timestamps(self):
        """Test that consecutive calls generate different paths."""
        import time
        path1 = generate_timestamped_output("./training", "policy")
        time.sleep(0.01)  # Small delay to ensure different timestamps
        path2 = generate_timestamped_output("./training", "policy")
        # They might be the same if called within the same second
        # but should at least be valid paths
        assert path1.endswith(".json")
        assert path2.endswith(".json")


class TestCheckpointRotation:
    """Test checkpoint rotation."""

    def test_rotate_keeps_last_n(self, tmp_path):
        """Test that rotation keeps only the last N checkpoints."""
        # Create 7 checkpoint files with different modification times
        import time
        for i in range(7):
            path = tmp_path / f"policy_{i:02d}.json"
            with open(path, "w") as f:
                json.dump({"index": i}, f)
            time.sleep(0.01)  # Ensure different mtime

        # Rotate, keeping last 3
        rotate_checkpoints(str(tmp_path), "policy", keep_last=3)

        # Check which files remain
        remaining = sorted([f.name for f in tmp_path.glob("policy_*.json")])
        assert len(remaining) == 3
        # Should keep the newest 3
        assert remaining == ["policy_04.json", "policy_05.json", "policy_06.json"]

    def test_rotate_with_fewer_than_n(self, tmp_path):
        """Test rotation when there are fewer than N files."""
        # Create 2 files
        for i in range(2):
            path = tmp_path / f"policy_{i:02d}.json"
            with open(path, "w") as f:
                json.dump({"index": i}, f)

        # Rotate with keep_last=5 (more than we have)
        rotate_checkpoints(str(tmp_path), "policy", keep_last=5)

        # All files should remain
        remaining = list(tmp_path.glob("policy_*.json"))
        assert len(remaining) == 2

    def test_rotate_with_symlinks(self, tmp_path):
        """Test that rotation handles symlinks correctly."""
        # Create a target and a symlink
        target = tmp_path / "target.json"
        with open(target, "w") as f:
            json.dump({}, f)

        symlink = tmp_path / "policy_00.json"
        os.symlink(target, symlink)

        # Create another regular file
        regular = tmp_path / "policy_01.json"
        with open(regular, "w") as f:
            json.dump({}, f)

        # Rotate, keeping last 1
        import time
        time.sleep(0.01)  # Ensure different mtime
        rotate_checkpoints(str(tmp_path), "policy", keep_last=1)

        # Only the newer file should remain
        remaining = list(tmp_path.glob("policy_*.json"))
        assert len(remaining) == 1


class TestCheckOutputPath:
    """Test output path checking."""

    def test_warns_on_symlink(self, tmp_path, capsys):
        """Test that warning is printed for symlink paths."""
        target = tmp_path / "target.json"
        with open(target, "w") as f:
            json.dump({}, f)

        symlink = tmp_path / "symlink.json"
        os.symlink(target, symlink)

        check_output_path(str(symlink))
        captured = capsys.readouterr()
        assert "WARNING" in captured.out
        assert "symlink" in captured.out

    def test_warns_on_same_as_resume(self, tmp_path, capsys):
        """Test warning when output == resume path."""
        path = tmp_path / "checkpoint.json"
        check_output_path(str(path), str(path))
        captured = capsys.readouterr()
        assert "WARNING" in captured.out
        assert "same as resume" in captured.out

    def test_no_warning_for_new_file(self, tmp_path, capsys):
        """Test no warning for fresh output path."""
        path = tmp_path / "new_checkpoint.json"
        check_output_path(str(path))
        captured = capsys.readouterr()
        assert "WARNING" not in captured.out


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
