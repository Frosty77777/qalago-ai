"""Read-only smoke against a running API. Uses fixed public demo origins."""
import argparse
import json
from urllib.request import Request, urlopen


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    args = parser.parse_args()
    def call(path, payload=None):
        request = Request(args.base_url+path, data=json.dumps(payload).encode() if payload else None,
                          headers={"Content-Type":"application/json"})
        with urlopen(request,timeout=15) as response:
            assert response.status==200
            return json.load(response)
    health=call("/api/health")
    assert health["poi_count"]>0, "Collect real POIs before live-data smoke"
    page=call("/api/pois?limit=3")
    assert isinstance(page,list) and len(page)==3
    cases=[("coffee","en"),("серуен","kk"),("парк","ru")]
    summary=[]
    for query,language in cases:
        result=call("/api/recommend",{"query":query,"lat":51.089,"lon":71.416,
                    "max_minutes":60,"language":language})
        assert 1<=len(result["recommendations"])<=3
        assert sum(p["visit_minutes"] for p in result["recommendations"])<=60
        assert all(p["source_url"]=="https://www.openstreetmap.org/"+p["id"]
                   and p["walk_minutes"] is None and p["availability_status"]=="unknown"
                   for p in result["recommendations"])
        summary.append({"language":language,"poi_ids":[p["id"] for p in result["recommendations"]]})
    print(json.dumps({"health":health,"scenarios":summary,"status":"passed"},ensure_ascii=True,indent=2))


if __name__=="__main__":
    main()
