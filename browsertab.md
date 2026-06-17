Please fix the browser tab title and favicon for Clinic Dr. Alwani Management System.

Current issue:
The browser tab still shows wrong titles such as “Controlled: 0” on some pages. This looks like debug text and is not professional.
The favicon also needs to be changed to a new logo file.

I already added a new logo file named:
Logo_Whitemode.png

I want to use Logo_Whitemode.png as the browser tab icon/favicon.

I also want the browser tab title to consistently show:
Clinic Dr. Alwani

Important:
- Do NOT change backend code.
- Do NOT change routing logic.
- Do NOT change authentication logic.
- Do NOT change sidebar logo.
- Do NOT change login logo.
- Do NOT redesign the UI.
- Do NOT change any page functionality.
- This task is only for browser tab favicon and document title.

Required title fix:

1. Search the whole frontend for anything setting the browser title.

Search for:
- document.title
- <title>
- Helmet
- react-helmet
- Controlled
- Controlled: 0
- frontend

2. Remove or replace any title logic that sets the browser tab title to:
- Controlled: 0
- frontend
- debug text
- status count
- page state value
- any wrong dynamic value

3. Set the browser tab title consistently to:

Clinic Dr. Alwani

Update index.html:

<title>Clinic Dr. Alwani</title>

If React code dynamically changes document.title, replace it with:

document.title = "Clinic Dr. Alwani";

4. Do not use “Controlled: 0” as the browser tab title.

“Controlled: 0” is not suitable for dashboard or any page. It looks like debugging information and must not appear in the browser tab.

Preferred final behavior:
Every page should show:
Clinic Dr. Alwani

Do not use page-specific titles for now.
Do not use:
Dashboard
Controlled: 0
frontend
Patients
Reports

Use only:
Clinic Dr. Alwani

Required favicon fix:

1. Use Logo_Whitemode.png as the browser tab favicon.

Recommended location:
frontend/public/Logo_Whitemode.png

If Logo_Whitemode.png is currently inside src/assets, copy or move it to the public folder because favicon links in index.html should use a public path.

2. Update index.html favicon links.

Use:

<link rel="icon" type="image/png" href="/Logo_Whitemode.png" />
<link rel="apple-touch-icon" href="/Logo_Whitemode.png" />

If using size attributes, use:

<link rel="icon" type="image/png" sizes="32x32" href="/Logo_Whitemode.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/Logo_Whitemode.png" />
<link rel="apple-touch-icon" href="/Logo_Whitemode.png" />

3. Remove old/default favicon references.

Remove or replace references such as:
- /vite.svg
- favicon.ico
- Logo_sidebar.png
- old logo
- default React/Vite favicon

Make sure the browser tab does not use the old icon anymore.

4. Fix favicon appearing too small if needed.

If Logo_Whitemode.png appears too small in the browser tab, inspect whether the image has too much transparent padding around the logo.

If it has excessive transparent padding:
- Create a favicon-friendly cropped version from Logo_Whitemode.png.
- Name it favicon.png.
- Put it in frontend/public/favicon.png.
- Use favicon.png for the 32x32 browser tab icon.
- Keep Logo_Whitemode.png for apple-touch-icon or larger icon if needed.

Example:

<link rel="icon" type="image/png" sizes="32x32" href="/favicon.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/Logo_Whitemode.png" />
<link rel="apple-touch-icon" href="/Logo_Whitemode.png" />

Important:
Only create favicon.png if Logo_Whitemode.png looks too small due to transparent padding.
Otherwise, use Logo_Whitemode.png directly.

5. Make sure favicon is clear.

Expected:
- Browser tab icon should show the Clinic Dr. Alwani logo clearly.
- It should use Logo_Whitemode.png or the cropped favicon.png created from Logo_Whitemode.png.
- It should not use Logo_sidebar.png anymore.
- It should not use Vite/React default icon.
- It should not look tiny because of excessive transparent padding.

6. Browser cache note.

After changing favicon:
- Stop the dev server.
- Restart npm run dev.
- Hard refresh browser.
- If the icon still does not change, open in incognito or clear browser favicon cache.

Favicon changes can be cached by the browser.

Final checks:
- Run npm run build.
- Open the app in browser.
- Browser tab title should show Clinic Dr. Alwani.
- It should not show Controlled: 0.
- It should not show frontend.
- Favicon should use Logo_Whitemode.png or cropped favicon.png created from Logo_Whitemode.png.
- Navigate to Dashboard, Patients, Reports, Sales, Inventory, and Login.
- Confirm the title remains Clinic Dr. Alwani on every page.
- Confirm no backend files were changed.
- Confirm no UI functionality was changed.

Final output:
Provide a summary of:
- Files modified
- Title value used
- Favicon file used
- Whether Logo_Whitemode.png was placed in public folder
- Whether a cropped favicon.png was created
- Whether npm run build passed