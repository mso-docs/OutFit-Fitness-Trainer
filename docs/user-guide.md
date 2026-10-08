# OutFit Help

OutFit helps you make room for manageable activity, a little time outside, and recovery. It offers general fitness support for adults.

## Get started

1. Return to OutFit and complete the four-step profile setup.
2. Choose a goal and the days/minutes you have available.
3. Open **My plan** and create a seven-day preview. Review it before accepting.
4. Use **Today** to see your session, log what happened, or check in on recovery.

You can edit optional height and weight in **Settings**. Metric and imperial entry are supported. Measurements do not set calorie targets or override exercise limits.

## Connect your local AI

The browser edition calls Ollama directly. Its default address is `http://127.0.0.1:11434` on the computer running your browser.

1. Install/start Ollama and install a model that fits your computer.
2. Allow this site's exact origin in `OLLAMA_ORIGINS`, then restart Ollama. Use the origin shown in **Settings → Connection help**; do not include the project path or use a wildcard.
3. In **Settings**, save the Ollama address if needed, refresh AI status, and select an installed model.
4. Allow local-network access if your browser requests it.

A phone's localhost points to the phone, not a laptop. A trusted remote endpoint can be entered in Settings; AI context and messages will be sent there. The optional OutFit server edition is another way to run the app locally.

For platform-specific setup, see the [Ollama documentation](https://docs.ollama.com/faq).

## Plans and fallback

Every plan is checked against your schedule, activity catalog, recovery and safety limits. When AI is unavailable, too slow, or returns an invalid proposal, OutFit creates a clearly labelled **Fallback planner** preview. You can still review and accept that plan.

An existing fallback draft does not change when AI reconnects. Discard it and generate another preview. For an accepted week, choose **Adjust this week**; changes apply only after acceptance. Rest days are recommendations too.

## Chat with your trainer

Open **Trainer** to discuss habits, motivation or your saved plan. Markdown formatting is supported. Chat does not change accepted plans. Use a plan preview for changes.

Conversations are temporary: leaving the Trainer screen or reloading clears them. Messages, your plan and activity summary go to your chosen model server. Body measurements and raw log notes are excluded from automatic context; anything you type yourself is still sent. Chat is not medical care or clearance to exercise.

## Log activity and recovery

Use Today or Progress to record completed, partial, skipped or unplanned activity. Log what actually happened, including duration and optional effort/distance/outdoor status. Use a check-in for sleep, energy, soreness or symptoms.

Safety flags pause exercise recommendations. Editing or deleting the original observation does not silently clear the pause. Review the safety screen after obtaining appropriate guidance.

## Health apps and imported results

**Health data** shows imported activity with its source, date, duration and optional distance. Upload an OutFit-format JSON file from a compatible adapter/export tool; raw provider exports need conversion first. The import format is shown on that screen.

Live health-app connections are not implemented yet. Imports stay separate from manual progress to avoid counting the same workout twice. Steps, sleep and heart-rate data are not invented from activity duration.

See [Health integrations](health-integrations.md) for the Strava web-connection and Apple/Android phone-bridge design.

## Privacy, export and deletion

The Pages/browser edition stores your data in this site's browser storage. It is not encrypted by OutFit, and scripts on the same website origin can access it. Use a trusted device/origin, export backups, and remove your data on shared devices. Clearing browser storage or changing site origins can remove access to saved records.

The optional server edition stores data in its local SQLite database. It does not share data automatically with browser mode. Neither edition uploads your profile to GitHub Pages. AI context goes to your chosen Ollama endpoint.

In **Settings**, choose **Export JSON** to download your records. **Delete local data** requires typing `DELETE_MY_DATA`. Downloaded backups remain on your device until you remove them yourself.

## Troubleshooting

- **AI offline:** check that Ollama is running, the address is correct, the site's origin is permitted, and browser local-network permissions allow access. Then refresh AI status in Settings.
- **AI selected but fallback remains:** discard an old fallback draft and generate again. Slow or invalid model output still falls back safely.
- **Your data changed:** refresh, then make a new preview or retry the edit. Browser operations also check revisions to protect saved records.
- **No saved data on another device:** browser storage is device/browser/origin-specific. There is no automatic account sync.
- **Browser storage unavailable:** check private-browsing/storage policies. Export backups while the app is accessible. Clearing site storage removes browser-mode records.
