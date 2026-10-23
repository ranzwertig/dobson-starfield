#!/usr/bin/env python3
"""Get your synced Zenigo data without the app: fetches the encrypted copy of a sync group and decrypts it.

    pip install cryptography
    python3 sync-recover.py "https://zenigo.app/app/#join=<code>" > zenigo-data.json

Instead of the link the bare code works too. With a second argument (a file with the encrypted copy) nothing is
fetched. The result is the group's data as JSON: list, starred, log (the logbook), settings and devices.

How it works (src/sync.js): from the 32-byte sync code, HKDF-SHA256 (salt "zenigo-sync") derives the group id (16 bytes,
info "zenigo-sync-v1 id"), the server password (32 bytes, "zenigo-sync-v1 auth") and the AES-256-GCM key (32 bytes,
"zenigo-sync-v1 enc"); id and password are base64url without padding. The copy is [version 1][compression: 0 none,
1 gzip][12 bytes IV][AES-GCM ciphertext with tag], additional data "zenigo-sync/1/<id>", content JSON.
"""
import base64, gzip, json, re, sys, urllib.request
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

SERVER = "https://zenigo.app"

def b64u(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")
def unb64u(s): return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))
def derive(code, info, n):
    return HKDF(algorithm=hashes.SHA256(), length=n, salt=b"zenigo-sync", info=info.encode()).derive(unb64u(code))

def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    m = re.search(r"(?:join=)?([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])", sys.argv[1])
    if not m: sys.exit("That is not a Zenigo sync link or code.")
    code = m.group(1)
    gid, token, key = b64u(derive(code, "zenigo-sync-v1 id", 16)), b64u(derive(code, "zenigo-sync-v1 auth", 32)), derive(code, "zenigo-sync-v1 enc", 32)
    if len(sys.argv) > 2:
        data = open(sys.argv[2], "rb").read()
    else:
        req = urllib.request.Request(f"{SERVER}/api/sync/v1/{gid}", headers={"Authorization": "Bearer " + token, "User-Agent": "zenigo-sync-recover"})
        data = urllib.request.urlopen(req).read()
    if data[0] != 1: sys.exit("Unknown format version %d: use a newer version of this script." % data[0])
    plain = AESGCM(key).decrypt(data[2:14], data[14:], f"zenigo-sync/1/{gid}".encode())
    if data[1] == 1: plain = gzip.decompress(plain)
    print(json.dumps(json.loads(plain), indent=1, ensure_ascii=False))

if __name__ == "__main__":
    main()
