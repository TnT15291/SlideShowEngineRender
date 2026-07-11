---

# User Intent First

Before any photo filtering or selection, the pipeline must understand the user's intent.

The system should never assume that removing photos is always correct.

Examples

## Case 1

User request

> Keep every photo.

Pipeline behavior

```
Filtering

↓

Disabled
```

Duplicates, blurry photos and low-quality photos are all preserved.

The AI may still:

- change duration
- reduce display time
- use collage
- use film roll

but **must not remove any photo.**

---

## Case 2

User request

> Use only the best photos.

Pipeline behavior

```
Filtering

↓

Enabled
```

Rule Engine

+

Vision

may freely reject

- duplicates
- blurry photos
- weak composition
- low emotional value

---

## Case 3

User request

> Keep all ceremony photos, but simplify guest photos.

Pipeline behavior

Filtering becomes selective.

Rules become

```
Ceremony

↓

Keep All

Guest Photos

↓

AI Selection

Decoration

↓

Rule Selection
```

---

# Selection Policy

Before Rule Filtering, the pipeline generates

```
selection_policy.json
```

Example

```json
{
    "mode":"keep_all"
}
```

---

```json
{
    "mode":"best_only"
}
```

---

```json
{
    "mode":"hybrid",

    "keepCategories":[
        "ceremony",
        "family"
    ],

    "optimizeCategories":[
        "friends",
        "decoration"
    ]
}
```

---

# Rule Filtering Must Respect Selection Policy

Filtering is no longer

```
Rule

↓

Delete
```

Filtering becomes

```
Selection Policy

+

Rule

↓

Decision
```

---

# Philosophy

The AI should optimize the movie,

**not change the user's intention.**

If the customer wants to preserve every memory,

the AI should find a better way to present them,

instead of silently removing photos.