image_tag = "7cdf18c"

# Non-thinking for now (faster, cheaper); flip to `true` to enable reasoning.
# Later could be per-session from Firestore instead of a fixed git choice.
thinking_mode_on = false

# Minimum retrieval relevance (0..1). Tuned up to 0.35 for stricter, more
# relevant sources.
min_score = 0.35
