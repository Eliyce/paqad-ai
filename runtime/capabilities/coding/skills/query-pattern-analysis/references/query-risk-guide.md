# Query Risk Guide

Check for:

- correctness drift from missing filters or ordering
- fan-out and N+1 patterns
- excessive payload size or write amplification
- hidden dependency on new schema or index assumptions
