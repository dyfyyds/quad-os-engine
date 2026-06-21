"""Mulberry32 PRNG 前后端逐位一致校验。

期望向量来自 `node frontend/scripts/rng_check.mjs`（seed=0x9E3779B9，前 8 个 next()）。
这是后续所有前后端 parity 的根基，必须先绿。
"""
from app.engines.rng import Mulberry32


def test_matches_frontend_vector():
    expected = [
        0.358889980242,
        0.105903261341,
        0.675290479325,
        0.91793455882,
        0.101577150403,
        0.301002923865,
        0.024990354199,
        0.466384648345,
    ]
    r = Mulberry32(0x9E3779B9)
    got = [round(r.next(), 12) for _ in range(8)]
    assert got == expected


def test_randint_range():
    r = Mulberry32(123)
    for _ in range(1000):
        v = r.randint(1, 4)
        assert 1 <= v <= 4


def test_state_advances():
    r = Mulberry32(0x9E3779B9)
    before = r.state
    r.next()
    assert r.state != before
