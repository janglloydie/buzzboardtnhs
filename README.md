# Buzzboard: setup guide

Buzzboard is a live class quiz. You host from a laptop connected to the projector, and students join on their own phones or tablets with a 6-digit code. They don't need an account or an app.

It runs on two free services:

- **Firebase** (by Google) stores the live games, your quizzes, and past scores.
- **GitHub Pages** hosts the web pages that you and your students open.

Setup takes about 15 to 20 minutes and only has to be done once. You'll need a Google account and a computer (not a phone).

## What's in this folder

| File | What it's for |
| --- | --- |
| `index.html` | The student page. This is the link you share with your class. |
| `host.html` | The teacher page, where you sign in, import quizzes, and host. |
| `js/config.js` | Where you paste your Firebase settings (step 2). |
| `firestore.rules` | Security rules you paste into Firebase (step 1.6). |
| `sample-quiz.xml` | A 3-question quiz for your first test. |
| `css/`, `js/` | The app itself. You don't need to change anything else. |

---

## Part 1: Set up Firebase

Firebase's menus change from time to time, so a button may be worded a little differently from what's described here.

### 1.1 Create a project

1. Go to **https://console.firebase.google.com** and sign in with your Google account.
2. Click **Create a project** (or **Add project**).
3. Name it something like `buzzboard-class` and continue.
4. When asked about Google Analytics, you can turn it **off**. Buzzboard doesn't use it.
5. Click **Create project**, wait for it to finish, then click **Continue**.

Your project starts on the free **Spark** plan. If you're ever offered the **Blaze** plan, skip it; Buzzboard doesn't need it.

### 1.2 Register the web app and copy its settings

1. On the project's home page, click the **Web** icon, which looks like `</>`.
2. Enter a nickname such as `Buzzboard web` and click **Register app**. Leave "Also set up Firebase Hosting" unchecked.
3. Firebase shows a block of code containing `const firebaseConfig = { ... }`. **Copy the part between the curly braces** (`apiKey`, `authDomain`, `projectId`, and so on) into a note. You'll paste it in step 2.
4. Click **Continue to console**.

You can find these settings again later under the gear icon ⚙️ > **Project settings** > **General**, then scroll to **Your apps**.

### 1.3 Turn on sign-in

1. In the left menu, open **Build** > **Authentication** and click **Get started**.
2. On the **Sign-in method** tab, click **Anonymous**, switch it on, and click **Save**. This lets students join without accounts.
3. Click **Add new provider** > **Email/Password**. Switch on the first toggle (Email/Password) only, and click **Save**. This is how teachers sign in.

### 1.4 Create your teacher account

1. Still in **Authentication**, open the **Users** tab and click **Add user**.
2. Enter your email address and a password, then click **Add user**.

Repeat this for any other teacher who will host games.

### 1.5 Create the database

1. In the left menu, open **Build** > **Firestore Database** and click **Create database**.
2. If you're asked to choose an edition, pick **Standard**.
3. For the location, choose one close to your school. In the Philippines, **asia-southeast1 (Singapore)** is a good choice. **The location can't be changed later.**
4. Choose **Start in production mode**, then click **Create**.

### 1.6 Add the security rules

These rules make sure students can only submit their own answers, and only listed teachers can host or see saved scores.

1. In **Firestore Database**, open the **Rules** tab.
2. Delete everything in the editor.
3. Open `firestore.rules` from this folder in a text editor (Notepad, TextEdit), copy all of it, and paste it into the Firebase editor.
4. Find this line near the top and replace the example with the teacher email(s) from step 1.4, in lowercase and inside quotes:

   ```
   return ['teacher@example.com'];
   ```

   For two teachers, it would look like this:

   ```
   return ['ms.reyes@school.edu', 'mr.cruz@school.edu'];
   ```

5. Click **Publish**.

To add a teacher later, create their account (step 1.4), add their email to this list, and publish again.

---

## Part 2: Connect the app to Firebase

1. Open `js/config.js` in a text editor.
2. Replace each `PASTE_...` value with the matching value you copied in step 1.2. Keep the quotes and commas. For example:

   ```js
   export const firebaseConfig = {
     apiKey: "AIzaSyB1a2b3c4d5e6f7g8h9i0",
     authDomain: "buzzboard-class.firebaseapp.com",
     projectId: "buzzboard-class",
     storageBucket: "buzzboard-class.appspot.com",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123def456"
   };
   ```

3. Save the file.

These values aren't passwords. They only tell the app which Firebase project to use, so it's fine for them to be public. The rules from step 1.6 are what protect your data.

---

## Part 3: Put the pages on GitHub Pages

### 3.1 Create a repository

1. Create a free account at **https://github.com** if you don't have one. Your username becomes part of your web address.
2. Click the **+** in the top-right corner > **New repository**.
3. Name it `buzzboard`. Keep it **Public** (free GitHub Pages sites have to be public).
4. Click **Create repository**.

### 3.2 Upload the files

1. On the new repository's page, click the link **uploading an existing file**.
2. Open this Buzzboard folder on your computer, select **everything inside it** (the `css` and `js` folders plus all the files), and drag it onto the GitHub page. Chrome and Edge handle folders best.
3. Check that the list shows `index.html`, `host.html`, and files inside `css/` and `js/`, including your edited `js/config.js`.
4. Click **Commit changes**.

Upload the files themselves, not the `.zip`. GitHub Pages can't open a zip.

### 3.3 Turn on GitHub Pages

1. In the repository, open **Settings** > **Pages** (in the left menu).
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**.
3. Set **Branch** to **main** and the folder to **/ (root)**, then click **Save**.
4. Wait 1 to 2 minutes and refresh. A box appears saying your site is live, with its address.

Your two links will be:

- **Students:** `https://YOUR-USERNAME.github.io/buzzboard/`
- **Teacher:** `https://YOUR-USERNAME.github.io/buzzboard/host.html`

Bookmark the teacher link. Students don't need to see it; the lobby screen shows them a QR code and the student link.

---

## Part 4: Test run

1. Open the **teacher link** on your laptop and sign in with the account from step 1.4.
2. Click **Import XML** > **Choose .xml file**, pick `sample-quiz.xml`, and click **Save quiz**.
3. Click **Host live**. The lobby shows a code and a QR code.
4. On your phone, scan the QR code (or open the student link and type the code), pick a nickname, and join.
5. Your name pops up on the laptop. Click **Start the quiz** and play through it.
6. At the end, click **Back to my quizzes** > **Past games** to see the saved scores and download a CSV.

## Using your quizzes from Claude

In Buzzboard on Claude, open **My quizzes**, tap **View XML** on a quiz, and copy it. On your teacher page, click **Import XML**, paste it, click **Check XML**, then **Save quiz**. You can also paste XML from anywhere else as long as it follows the format below.

```xml
<quiz title="Solar System Warm-up">
  <question time="20">
    <text>Which planet is closest to the Sun?</text>
    <choice correct="true">Mercury</choice>
    <choice>Venus</choice>
    <choice>Earth</choice>
    <choice>Mars</choice>
  </question>
</quiz>
```

Each question needs 2 to 4 choices, with `correct="true"` on the right one. `time` is in seconds (5 to 120, default 20). Several `<quiz>` elements inside a `<quizzes>` root import as separate quizzes.

---

## Troubleshooting

**"Firebase isn't connected yet."** `js/config.js` still has `PASTE_` values, or the edited file wasn't uploaded. Fix it and upload `config.js` again (see "Updating the files" below).

**"The database refused that" when hosting or importing.** Your email isn't in the teacher list in the rules, is spelled differently, or the rules weren't published. Recheck step 1.6.

**"That email and password don't match a teacher account."** Check the account under Authentication > Users. You can reset the password there, or use the reset button on the sign-in page.

**Students are stuck on "Connecting…" or see a message about anonymous sign-in.** Anonymous sign-in isn't switched on. Recheck step 1.3.

**"No game uses that code."** The student typed the code wrong, or the game has ended. Codes are 6 digits.

**My changes don't show up.** GitHub Pages can take a couple of minutes to update. Then refresh with Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac).

**A student's phone reloaded mid-game.** They just reopen the student link and are put back in automatically, with their score kept. The same works for the host screen.

## Updating the files

If you get a new version of a file, open the repository on GitHub, click **Add file** > **Upload files**, drag in the new file(s) into the same folders, and click **Commit changes**. Files with the same name are replaced.

## Staying within the free plan

Every screen update in a live game counts as a database "read" for each connected device. A 20-question game with 30 students uses roughly 3,000 reads. At the time of writing, the free plan allows 50,000 reads a day, so several full class games a day fit comfortably. You can check usage under **Firestore Database** > **Usage**. If a limit is ever reached, Firebase pauses until the next day rather than charging you.

To keep things tidy, delete old games you no longer need under **Past games**. That removes both the saved scores and the leftover live-game data.
