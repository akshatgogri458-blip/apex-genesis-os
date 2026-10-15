import sys
import json
import sqlite3

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing db_path"}))
        return
    db_path = sys.argv[1]
    conn = sqlite3.connect(db_path, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA journal_mode = WAL;")

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            op = req.get("op")
            sql = req.get("sql", "")
            params = req.get("params", [])
            if op == "exec":
                conn.executescript(sql)
                sys.stdout.write(json.dumps({"ok": True, "rowsRead": 0, "rowsWritten": 0}) + "\n")
                sys.stdout.flush()
            elif op == "all":
                cur = conn.execute(sql, params)
                rows = [dict(r) for r in cur.fetchall()]
                is_write = sql.strip().upper().startswith(("INSERT", "UPDATE", "DELETE", "REPLACE"))
                sys.stdout.write(json.dumps({
                    "ok": True,
                    "results": rows,
                    "rowsRead": len(rows) if not is_write else 0,
                    "rowsWritten": cur.rowcount if is_write and cur.rowcount > 0 else 0,
                    "changes": cur.rowcount
                }) + "\n")
                sys.stdout.flush()
            elif op == "run":
                cur = conn.execute(sql, params)
                sys.stdout.write(json.dumps({
                    "ok": True,
                    "rowsRead": 0,
                    "rowsWritten": max(0, cur.rowcount),
                    "changes": max(0, cur.rowcount),
                    "lastRowId": cur.lastrowid
                }) + "\n")
                sys.stdout.flush()
            elif op == "close":
                conn.close()
                sys.stdout.write(json.dumps({"ok": True}) + "\n")
                sys.stdout.flush()
                break
        except Exception as e:
            sys.stdout.write(json.dumps({"ok": False, "error": str(e)}) + "\n")
            sys.stdout.flush()

if __name__ == "__main__":
    main()
