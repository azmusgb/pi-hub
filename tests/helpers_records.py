"""Shared helper for the records tests."""
from hub import records

T = 1000


def merged(rec, at=T):
    return records.merge(None, rec, at)
