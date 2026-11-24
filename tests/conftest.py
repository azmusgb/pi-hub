"""Shared test setup. Kept to what every test needs and nothing that changes what a test checks."""
from hub import auth

# The owner password is hashed with scrypt at n=2**14 (122 ms a hash on the Pi), and most test fixtures set up a hub,
# so the suite spent minutes hashing. Tests only need the hash to round-trip, so they use a cheap cost. This patches the
# module in this process only; tests/test_auth_cost.py pins the production value from a fresh interpreter.
auth.SCRYPT_COST = {"n": 2, "r": 1, "p": 1, "dklen": 32}
