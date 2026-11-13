"""Build artifact/beamtime.html: the same game page, in the shape the claude.ai Artifact tool publishes
(no doctype/html/head/body of our own; the bundle and photos are published next to it as files)."""
import pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'index.html').read_text(encoding='utf-8')
style = re.search(r'<style>(.*?)</style>', src, re.S).group(1)
body = re.search(r'<body>(.*?)</body>', src, re.S).group(1)
body = re.sub(r'<!--.*?-->\s*', '', body, flags=re.S)
body = re.sub(r'<script[^>]*></script>\s*', '', body)
# a full-screen game: fixed canvas, explicit dark background, single dark look
style = style.replace("html, body { margin: 0; height: 100%; overflow: hidden; background: #0b0f14; font-family: var(--font); color: #fff; }",
                      "html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); font-family: var(--font); color: var(--fg); }")
style = style.replace("#game { display: block; width: 100vw; height: 100vh; }", "#game { display: block; position: fixed; inset: 0; width: 100%; height: 100%; }")
style = style.replace(":root {", ":root { color-scheme: dark; --bg: #0b0f14; --fg: #ffffff;", 1)
out = f"""<title>MAX IV Explorer</title>
<style>{style}</style>
{body.strip()}
<script src="game.bundle.js"></script>
"""
(root / 'artifact/beamtime.html').write_text(out, encoding='utf-8')
print('artifact/beamtime.html', len(out) // 1024, 'KB')
