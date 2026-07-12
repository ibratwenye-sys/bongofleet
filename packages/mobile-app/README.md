# mobile-app (placeholder)

Not yet scaffolded. Per the project order (payments → auth → mobile app), this
package will be filled in with an Expo (managed workflow) React Native app once
the backend auth and payment APIs it depends on exist.

To scaffold when ready:

```bash
cd packages
pnpm dlx create-expo-app mobile-app --template
```

Then wire it into the pnpm workspace and add `@bongofleet/shared-lib` as a dependency
for shared types/DTOs.
