# KQ1 style statistics

Measured by `app/scripts/style-stats.ts` over the 75 reference scenes in `reference/kq1/`.

## Frame

Edges that are ≥90% black: top row 75/75, bottom row 75/75, left column 75/75, right column 75/75.

## Colour usage (all scenes)

| # | colour | share |
|---|---|---|
| 10 | lightgreen | 30.4% |
| 0 | black | 13.5% |
| 2 | green | 10.8% |
| 6 | brown | 9.6% |
| 1 | blue | 9.6% |
| 7 | lightgrey | 8.7% |
| 9 | lightblue | 5.2% |
| 3 | cyan | 3.9% |
| 8 | darkgrey | 3.1% |
| 15 | white | 2.7% |
| 14 | yellow | 0.8% |
| 4 | red | 0.6% |
| 11 | lightcyan | 0.5% |
| 12 | lightred | 0.4% |
| 13 | lightmagenta | 0.1% |
| 5 | magenta | 0.1% |

## Outdoor layout (37 scenes whose top rows are blue sky)

- Sky (blue, colour 1) fills rows 1-14 in the median scene (range 4-55).
- Directly below the sky, a light-blue (9) "distant hills/horizon" strip is 10 rows tall in the median scene.

### Dominant colours by height (outdoor scenes)

| rows | top colours |
|---|---|
| 0-11 | blue 64.7%, green 12.7%, black 11.4%, cyan 4.4% |
| 12-23 | lightblue 32.3%, blue 27.8%, green 16.5%, cyan 8.4% |
| 24-35 | green 38.1%, lightblue 22.1%, cyan 13.3%, darkgrey 5.4% |
| 36-47 | lightgreen 36.6%, green 23.4%, cyan 14.1%, black 5.4% |
| 48-59 | lightgreen 43.7%, cyan 12.6%, green 8.6%, brown 7.4% |
| 60-71 | lightgreen 39.1%, brown 12.0%, cyan 10.3%, green 7.7% |
| 72-83 | lightgreen 40.0%, blue 13.3%, brown 10.5%, green 9.3% |
| 84-95 | lightgreen 41.9%, blue 15.0%, brown 9.8%, green 8.9% |
| 96-107 | lightgreen 44.5%, blue 16.2%, brown 10.4%, green 6.9% |
| 108-119 | lightgreen 48.0%, blue 15.0%, brown 11.1%, green 6.2% |
| 120-131 | lightgreen 53.3%, blue 14.6%, brown 9.9%, green 4.7% |
| 132-143 | lightgreen 59.1%, blue 12.2%, brown 10.0%, lightgrey 4.6% |
| 144-155 | lightgreen 67.5%, blue 12.9%, brown 6.6%, green 3.9% |
| 156-167 | lightgreen 70.4%, blue 11.4%, black 10.1% |

## Colour neighbours

For each colour, the colours it most often touches (4-neighbour pixel pairs), all scenes.

| colour | most common neighbours |
|---|---|
| black | brown 21.2%, lightgreen 19.3%, lightgrey 15.8%, green 14.9% |
| blue | black 31.1%, lightblue 15.2%, lightgrey 14.3%, green 9.7% |
| green | black 32.5%, lightgreen 22.9%, cyan 16.2%, lightblue 8.3% |
| cyan | green 27.1%, black 25.0%, lightcyan 19.5%, lightgreen 15.1% |
| red | lightgrey 28.5%, darkgrey 20.5%, blue 19.6%, black 16.1% |
| magenta | green 54.2%, lightgreen 16.8%, black 12.0%, darkgrey 6.2% |
| brown | black 49.1%, darkgrey 17.7%, lightgreen 14.4%, green 6.7% |
| lightgrey | black 33.6%, darkgrey 30.5%, white 16.1%, blue 6.8% |
| darkgrey | lightgrey 37.8%, brown 20.1%, black 15.9%, lightblue 5.7% |
| lightblue | black 27.8%, green 21.6%, blue 19.3%, darkgrey 12.2% |
| lightgreen | black 41.6%, green 22.7%, brown 13.4%, cyan 8.9% |
| lightcyan | cyan 81.0%, black 9.2%, darkgrey 5.2%, lightblue 1.3% |
| lightred | blue 39.0%, darkgrey 29.8%, black 11.4%, lightgrey 5.1% |
| lightmagenta | black 75.3%, green 10.9%, lightgreen 8.0%, lightgrey 5.5% |
| yellow | black 26.7%, darkgrey 24.1%, brown 13.8%, green 11.1% |
| white | lightgrey 66.4%, black 13.2%, blue 8.7%, green 5.2% |

## Scene families

- Outdoor daytime scenes (blue sky at top): 37/75
- Dark scenes (>30% black - caves, tunnels, interiors at night): 12 (r05-c01, r05-c04, r05-c07, r06-c08, r06-c09, r07-c01, r07-c02, r07-c03, r07-c04, r07-c06, r07-c07, r07-c09)
- Cloud-land scenes (>15% white): 3 (r05-c08, r05-c12, r06-c12)
