# easy_localization Guide

Use this guide only when the project already uses `easy_localization` or has chosen it as the localization package.

## Baseline

- keep supported locales explicit
- keep translation files in one predictable assets path
- wrap app bootstrap once instead of scattering localization setup

## Usage

- use translation keys in UI, not hard-coded copy
- keep enum-to-translation mapping centralized
- add new keys for every supported locale in the same change
