import uvicorn

if __name__ == "__main__":
    # Loopback development endpoint; pass deployment proxy logging policy separately.
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, access_log=False)
