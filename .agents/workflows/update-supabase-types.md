---
description: Update Supabase TypeScript types
---
# Update Supabase Types

When the database schema changes, the local TypeScript definitions need to be updated. Follow these steps:

1. Ensure you have the Supabase CLI installed or available via npx.
2. Run the following command to generate the types (replace `<YOUR_PROJECT_ID>` with the actual project ID if running manually):

```bash
npx supabase gen types typescript --project-id <YOUR_PROJECT_ID> > lib/database.types.ts
```

3. Verify that `lib/database.types.ts` was successfully updated and contains the new schema definitions.
4. Check if any existing frontend code breaks due to the type changes and fix any TypeScript errors.
