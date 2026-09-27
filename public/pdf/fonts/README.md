# PDF fonts

`renderInvoicePdf.ts` (and any future PDF, e.g. an offer/quote) needs the
Creafluxe brand typeface, **Manrope**, embedded in specific weights.

The brand's source font is the *variable* font at
`public/fonts/Manrope-Variable.woff2` (weights 200–800 in one file). pdfkit
renders PDFs through [fontkit](https://github.com/foliojs/fontkit), which can
open a variable font but always embeds it at its single default (lightest)
instance — there is no way to ask pdfkit for "Manrope at weight 600" from
that one file. To get real weight contrast in a PDF (light address text,
semibold headings, bold emphasis) you need separate, static font files, one
per weight.

The files in this folder are exactly that: static instances cut from the
same variable font with [fonttools](https://github.com/fonttools/fonttools),
so they are pixel-identical to the brand's Manrope at each weight — nothing
was approximated or swapped for a lookalike font.

## Regenerating

Only needed if the brand's `Manrope-Variable.woff2` is ever replaced. Requires
Python with `pip install fonttools brotli` (brotli is needed to decompress
the `.woff2` container).

```python
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.ttLib import TTFont

src = "../../fonts/Manrope-Variable.woff2"  # public/fonts/Manrope-Variable.woff2
weights = {
    "Manrope-Light": 300,
    "Manrope-Regular": 400,
    "Manrope-Medium": 500,
    "Manrope-SemiBold": 600,
    "Manrope-Bold": 700,
}
for name, wght in weights.items():
    f = TTFont(src)
    f.flavor = None  # decompress woff2 -> a plain, pdfkit-friendly .ttf
    instantiateVariableFont(f, {"wght": wght}, inplace=True)
    f.save(f"{name}.ttf")
```

Then re-run `npm test` (covers `invoiceMath`, not layout) and eyeball a
rendered invoice — there's no automated visual check for the PDF.

## Why `public/pdf/` and not `src/`

These are read from disk at request time via `fs`/`path.join(process.cwd(), …)`
(pdfkit needs a real file path, not a bundled import), so they must survive
whatever the deploy step does to `src/`. Next.js always copies the whole
`public/` folder verbatim, in every build mode (`next start` and
`output: "standalone"` alike), so that's the one location guaranteed to be
on disk at runtime regardless of how this app ends up deployed.
