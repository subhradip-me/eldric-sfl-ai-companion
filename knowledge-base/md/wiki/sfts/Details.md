---
title: "SFT Details"
path: "/en/sfts/Details"
description: "a page dedicated to explaining the specifics of how some of the more confusing SFTs work in game."
updatedAt: "2026-02-27T07:50:38.465Z"
authorName: "iSPANK"
---
# SFT Details

## Green Amulet

“As far as I can tell Green Amulet is a 10% proc chance” - [iSPANK](/en/user-pages/iSPANK)

```plaintext
export function prngChance({
  farmId,
  itemId,
  counter,
  chance,
  criticalHitName,
}: {
  farmId: number;
  itemId: number;
  counter: number;
  chance: number;
  criticalHitName: CriticalHitName;
}) {
  const prngValue = prng({ farmId, itemId, counter, criticalHitName });

  return prngValue * 100 < chance;
}
```

```plaintext
const criticalDrop = (criticalHitName: CriticalHitName, chance: number) =>
    prngChance({ ...prngArgs, itemId, chance, criticalHitName });

    isWearableActive({ name: "Green Amulet", game }) &&
    criticalDrop("Green Amulet", 10)
  ) {
    amount *= 10;
    boostsUsed.push({ name: "Green Amulet", value: "x10" });
  }
```

> **Contributors to this page**
> 
> [iSPANK](/en/user-pages/iSPANK) - init page creation, layout, linking, tagging, code research
