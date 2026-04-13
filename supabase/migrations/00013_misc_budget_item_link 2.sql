-- Link auto-created misc draws to approved budget line items
ALTER TABLE misc_draws
  ADD COLUMN IF NOT EXISTS budget_item_id UUID REFERENCES budget_items(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_misc_draws_budget_item_id_unique
  ON misc_draws (budget_item_id)
  WHERE budget_item_id IS NOT NULL;
