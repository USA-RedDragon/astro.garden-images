#!/usr/bin/env python3
"""Build a single-file bundle of annotate.js for the PixInsight MCP bridge.

The bridge evaluates plain JavaScript: it cannot follow #include, and the
Script process cannot be given a file path. This expands annotate.js and the
stock ImageSolver/AnnotateImage sources it includes (#include, #define,
#undef, #ifdef/#ifndef, #__FILE__) into one file, wrapped as a function that
takes the options object, with a header that makes the stock engines run
without dialogs (non_interactive, MessageBox throws instead of opening).

Usage:
  bundle.py [-o BUNDLE] [--image PNG | --view ID] [--svg OUT.svg] [--target NAME]
            [--ra DEG --dec DEG] [--resolution ARCSEC_PX] [--date YYYY-MM-DD]
            [--resolve] [--report OUT.json]

Writes the bundle and prints the run_script code to paste into
mcp__pixinsight__run_script.
"""
import argparse
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INC = "/opt/PixInsight/include"

HEADER = r"""
var AG_HEADLESS = true;
var __log = [];
var __realC = Function("return console")();
var Parameters = {
  getBoolean: function(k){ return k == "non_interactive"; },
  has: function(k){ return false; }, get: function(k){ return undefined; },
  getString: function(k){ return ""; }, getReal: function(k){ return 0; },
  getInteger: function(k){ return 0; }, getUint: function(k){ return 0; },
  set: function(k,v){}, isViewTarget: false, isGlobalTarget: false, targetView: null
};
var MessageBox = function(msg){ this.execute = function(){ throw new Error("MessageBox suppressed: " + msg); }; };
var console = new Proxy({}, {
  get: function(t0, p){
    if (["writeln","write","warningln","criticalln","noteln","note","warning","critical"].indexOf(p) >= 0)
      return function(){ __log.push(Array.prototype.join.call(arguments, "")); return __realC[p].apply(__realC, arguments); };
    let v = __realC[p]; return (typeof v == "function") ? v.bind(__realC) : v;
  },
  set: function(t0, p, v){ __realC[p] = v; return true; }
});
"""

FOOTER = r"""
let __r = agAnnotate(AG_ARGS);
__r.log = __log.filter(function(s){ return /\[annotate\]|Error|error|\*\*\*|RMS|Catalog|stars found|Layer |Rendering|Overlapped|Image center|Resolution/.test(s); }).slice(-60);
if (AG_ARGS.report) File.writeTextFile(AG_ARGS.report, JSON.stringify(__r, null, 1));
return __r;
"""

KNOWN = ('ifdef', 'ifndef', 'else', 'endif', 'if', 'elif', 'define', 'undef', 'include', 'engine',
         'feature-id', 'feature-info', 'feature-icon', 'script-id', 'feature-button', 'error', 'warning', 'pragma')


class Preprocessor:
    def __init__(self):
        self.defines = {}

    def resolve(self, name, cur):
        if name.startswith('<'):
            return os.path.join(INC, name[1:-1])
        n = name[1:-1]
        return n if os.path.isabs(n) else os.path.join(os.path.dirname(cur), n)

    def subst(self, line):
        if not self.defines:
            return line
        parts = re.split(r'("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\'|//.*$)', line)
        rep = lambda m: self.defines.get(m.group(0), m.group(0))
        return ''.join(p if k % 2 else re.sub(r'\b[A-Za-z_]\w*\b', rep, p) for k, p in enumerate(parts))

    def process(self, path, out):
        stack = []
        lines = open(path, encoding='utf-8').read().split('\n')
        i = 0
        while i < len(lines):
            line = lines[i]
            i += 1
            s = line.strip()
            mk = re.match(r'#\s*([\w-]+)', s)
            if s.startswith('#') and mk and mk.group(1) in KNOWN:
                while s.endswith('\\') and i < len(lines):
                    s = s[:-1] + ' ' + lines[i].strip()
                    i += 1
                d, arg = re.match(r'#\s*([\w-]+)\s*(.*)', s).groups()
                arg = arg.strip()
                active = all(stack)
                out.append('')
                if d == 'ifdef':
                    stack.append(arg.split()[0] in self.defines)
                elif d == 'ifndef':
                    stack.append(arg.split()[0] not in self.defines)
                elif d == 'else':
                    stack[-1] = not stack[-1]
                elif d == 'endif':
                    stack.pop()
                elif d in ('if', 'elif'):
                    raise SystemExit("unsupported #%s in %s" % (d, path))
                elif not active:
                    pass
                elif d == 'define':
                    m = re.match(r'(\w+)(\(.*?\))?\s*(.*)', arg)
                    if m.group(2):
                        raise SystemExit("function-like macro not supported: " + s)
                    v = re.sub(r'/\*.*?\*/', '', m.group(3) or '')
                    v = re.sub(r'\s//.*$', '', v).strip()
                    self.defines[m.group(1)] = self.subst(v)
                elif d == 'undef':
                    self.defines.pop(arg.split()[0], None)
                elif d == 'include':
                    out.pop()
                    self.process(os.path.normpath(self.resolve(arg, path)), out)
                elif d in ('error',):
                    raise SystemExit("#error in %s: %s" % (path, arg))
                continue
            if all(stack):
                out.append(self.subst(line).replace('#__FILE__', json.dumps(path)).replace('#__LINE__', str(i)))
            else:
                out.append('')


def build(bundle_path):
    out = []
    Preprocessor().process(os.path.join(HERE, 'annotate.js'), out)
    with open(bundle_path, 'w', encoding='utf-8') as f:
        f.write('(function(AG_ARGS){\n' + HEADER + '\n'.join(out) + FOOTER + '\n})')


def large_png_to_tiff(png, outdir):
    """PixInsight reads PNG through Qt, whose image reader refuses images over
    256 MiB decoded (w*h*4 bytes, e.g. 12k x 8k): ImageWindow.open returns no
    window. Such PNGs are converted to an uncompressed TIFF in outdir."""
    import subprocess
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = None
    w, h = Image.open(png).size
    if w * h * 4 <= 256 * 1024 * 1024:
        return None
    tif = os.path.join(outdir, os.path.splitext(os.path.basename(png))[0] + '.tif')
    if not (os.path.exists(tif) and os.path.getmtime(tif) >= os.path.getmtime(png)):
        subprocess.run(['magick', png, '-compress', 'none', tif], check=True)
    print("%dx%d PNG is over Qt's 256 MiB limit; using %s" % (w, h, tif), file=sys.stderr)
    return tif


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('-o', '--bundle', default=os.path.join(os.environ.get('TMPDIR', '/tmp'), 'ag-annotate-bundle.js'))
    g = ap.add_mutually_exclusive_group()
    g.add_argument('--image', help='image file to open (closed again afterwards)')
    g.add_argument('--view', help='id of an already open view')
    ap.add_argument('--svg', help='output SVG path (default: <image>_annotated.svg next to the image)')
    ap.add_argument('--target', help='object name for a Sesame lookup when the image has no coordinates')
    ap.add_argument('--ra', type=float)
    ap.add_argument('--dec', type=float)
    ap.add_argument('--resolution', type=float, help='arcsec/px seed')
    ap.add_argument('--date', help='observation date for the solver (YYYY-MM-DD)')
    ap.add_argument('--resolve', action='store_true', help='solve even if the image has a solution')
    ap.add_argument('--overrides', help='override file (default <image dir>/<name>.annotate.json)')
    ap.add_argument('--style', help='style file (default style.json next to annotate.js)')
    ap.add_argument('--report', help='JSON report path (default <svg>.report.json)')
    ap.add_argument('--keep-open', action='store_true')
    a = ap.parse_args()

    build(a.bundle)
    print("bundle: %s (%d bytes)" % (a.bundle, os.path.getsize(a.bundle)), file=sys.stderr)
    if not (a.image or a.view):
        return
    args = {}
    if a.image:
        args['image'] = os.path.abspath(a.image)
    if a.view:
        args['view'] = a.view
    svg = a.svg or (os.path.splitext(args['image'])[0] + '_annotated.svg' if a.image else None)
    if not svg:
        raise SystemExit('--svg is required with --view')
    args['svg'] = os.path.abspath(svg)
    if a.image and a.image.lower().endswith('.png'):
        tif = large_png_to_tiff(args['image'], os.path.dirname(os.path.abspath(a.bundle)))
        if tif:
            ov = os.path.splitext(args['image'])[0] + '.annotate.json'
            if a.overrides is None and os.path.exists(ov):
                a.overrides = ov
            args['image'] = tif
    if a.report is None:
        a.report = os.path.splitext(args['svg'])[0] + '.report.json'
    for k in ('target', 'ra', 'dec', 'resolution', 'date', 'overrides', 'style', 'report'):
        v = getattr(a, k)
        if v is not None:
            args[k] = os.path.abspath(v) if k in ('overrides', 'style', 'report') else v
    if a.resolve:
        args['resolve'] = True
    if a.keep_open:
        args['keepOpen'] = True
    print('mcp__pixinsight__run_script code:\n')
    print('JSON.stringify(eval(File.readTextFile(%s))(%s), null, 1)' % (json.dumps(a.bundle), json.dumps(args)))
    print('\nThe bridge times out after 300 s; big images that need solving can take longer.'
          '\nPixInsight keeps running: wait for the report instead:\n  %s' % args['report'])


if __name__ == '__main__':
    main()
