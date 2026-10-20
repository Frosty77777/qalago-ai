import asyncio
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from app.hours import status_at
from app.intent import ModelIntent, interpret, parse_duration, parse_rules
from app.retrieval import normalize_text


@pytest.mark.parametrize("query, expected", [
    ("Хочу кофе", ["coffee"]),
    ("I want coffee.", ["coffee"]),
    ("Кофе ішкім келеді", ["coffee"]),
    ("Выпить кофе в кафе", ["coffee"]),
    ("Хочу поесть", ["food"]),
    ("I want something to eat.", ["food"]),
    ("Тамақ ішкім келеді", ["food"]),
    ("Хочу погулять в парке", ["park"]),
    ("I want to walk in a park.", ["park"]),
    ("Саябақта серуендегім келеді", ["park"]),
    ("Find a quiet place to study.", ["study"]),
    ("I have two hours and want coffee and a walk.", ["coffee", "park"]),
    ("Хочу в музей", ["museum"]),
])
def test_intent_to_category(query, expected):
    assert parse_rules(query).categories == expected


def test_constraints_are_extracted():
    intent = parse_rules("Find a quiet, cheap, wheelchair accessible cafe open now, by car")
    assert intent.quiet and intent.cheap and intent.accessible and intent.open_now
    assert intent.transport == "driving"
    assert parse_rules("Хочу кофе").transport is None
    assert parse_rules("Доехать на велосипеде до парка").transport == "bicycle"
    assert parse_rules("кофе, поеду на автобусе").transport == "public_transport"


@pytest.mark.parametrize("text, minutes", [
    ("i have two hours", 120), ("полтора часа", 90), ("на 30 минут", 30), ("екі сағат", 120),
    ("1.5 hours", 90), ("на час", 60), ("half an hour", 30), ("10 hours", 240), ("хочу кофе", None),
])
def test_duration_parsing(text, minutes):
    assert parse_duration(normalize_text(text)) == minutes


def test_vague_and_named_place_requests():
    vague = parse_rules("Куда сходить?")
    assert vague.vague and not vague.categories and vague.free_text is None
    named = parse_rules("Хочу в Байтерек")
    assert not named.categories and named.free_text == "байтерек"


class FakeModel:
    def __init__(self, result=None, fail=False):
        self.result, self.fail, self.calls = result, fail, 0

    async def classify(self, query):
        self.calls += 1
        if self.fail:
            raise RuntimeError("model down")
        return self.result


def test_model_used_only_when_rules_find_nothing(config):
    keyed = replace(config, api_key="test")
    model = FakeModel(ModelIntent(categories=["museum"]))
    assert asyncio.run(interpret("Хочу кофе", keyed, model)).categories == ["coffee"]
    assert model.calls == 0
    result = asyncio.run(interpret("что-то про искусство и историю страны", keyed, model))
    assert result.categories == ["museum"] and result.source == "model"


def test_model_place_name_must_come_from_the_request(config):
    keyed = replace(config, api_key="test")
    invented = asyncio.run(interpret("отведи меня туда", keyed, FakeModel(ModelIntent(place_name="Хан Шатыр"))))
    assert invented.free_text != "Хан Шатыр" and invented.source == "rules"
    quoted = asyncio.run(interpret("отведи меня в Хан Шатыр", keyed, FakeModel(ModelIntent(place_name="Хан Шатыр"))))
    assert quoted.free_text == "Хан Шатыр" and quoted.source == "model"


def test_model_failure_falls_back_to_rules(config):
    keyed = replace(config, api_key="test")
    result = asyncio.run(interpret("куда сходить", keyed, FakeModel(fail=True)))
    assert result.vague and result.source == "rules"


def test_override_replaces_parsed_categories(config):
    result = asyncio.run(interpret("куда сходить", config, None, ["park", "park", "coffee"]))
    assert result.categories == ["park", "coffee"] and not result.vague and result.source == "override"


WEEKDAYS = {"Mon": {"working_hours": [{"from": "09:00", "to": "18:00"}]},
            "Fri": {"working_hours": [{"from": "18:00", "to": "02:00"}]}}


@pytest.mark.parametrize("utc, expected", [
    (datetime(2026, 10, 19, 7, tzinfo=timezone.utc), ("open", "18:00")),     # Mon 12:00 local
    (datetime(2026, 10, 19, 14, tzinfo=timezone.utc), ("closed", None)),     # Mon 19:00 local
    (datetime(2026, 10, 20, 7, tzinfo=timezone.utc), ("closed", None)),      # Tue: day absent = closed
    (datetime(2026, 10, 23, 18, tzinfo=timezone.utc), ("open", "02:00")),    # Fri 23:00 local, overnight
    (datetime(2026, 10, 23, 20, tzinfo=timezone.utc), ("open", "02:00")),    # Sat 01:00 local, from Friday
    (datetime(2026, 10, 23, 22, tzinfo=timezone.utc), ("closed", None)),     # Sat 03:00 local
])
def test_schedule_status(utc, expected):
    assert status_at(WEEKDAYS, 300, utc) == expected


def test_missing_schedule_or_timezone_is_unknown():
    now = datetime(2026, 10, 19, 7, tzinfo=timezone.utc)
    assert status_at(None, 300, now) == ("unknown", None)
    assert status_at(WEEKDAYS, None, now) == ("unknown", None)
    assert status_at({"is_24x7": True}, 300, now) == ("open", None)
