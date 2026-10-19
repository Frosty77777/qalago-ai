from dataclasses import replace

import pytest

from app.geo import haversine_m
from app.models import RecommendRequest
from app.retrieval import Retriever


def test_haversine_near_far_and_dateline():
    assert haversine_m(51,71,51,71)==0
    assert 110 < haversine_m(51,71,51.001,71) < 112
    assert 90000 < haversine_m(51,71,52,71) < 120000
    assert haversine_m(0,179.999,0,-179.999) < 225


@pytest.mark.parametrize("query,category", [
    ("coffee","cafe"),("хочу кофе","cafe"),("кофехана","cafe"),
    ("park walk","park"),("в парке","park"),("саябақта серуен","park"),
    ("museum","museum"),("музей","museum"),("мұражай","museum"),
    ("library","library"),("библиотека","library"),("кітапхана","library"),
])
def test_multilingual_category_matching(store,config,request_body,query,category):
    request_body["query"]=query
    results=Retriever(store,config).search(RecommendRequest(**request_body))
    assert results and all(c.poi.category==category for c in results)


def test_distance_and_category_are_hard_constraints(store,config,req):
    results=Retriever(store,replace(config,radius_m=200)).search(req)
    assert [c.poi.id for c in results]==["node/1"]


def test_no_match_not_replaced_by_unrelated_place(store,config,req):
    results=Retriever(store,config).search(req.model_copy(update={"query":"zxqv987654"}))
    assert not results


def test_deterministic_and_debug_scores_bounded(store,config,req):
    r=Retriever(store,config)
    assert r.search(req)==r.search(req)
    assert all(0 <= c.score <= 1 for c in r.search(req))


def test_family_prefers_only_relevant_categories(store,config,req):
    results=Retriever(store,config).search(req.model_copy(update={"query":"family with child"}))
    assert results and {r.poi.category for r in results} <= {"park","garden","playground","museum"}
