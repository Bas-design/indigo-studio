# Adding a Project to Your Website

Everything happens in one place now — a little app called **Indigo
Studio** that runs on your own computer. You fill in a form, drop your
photos in, look at how it will appear, and press **Publish** when you are
happy. Nothing goes on the website until you press that button.

You do not need to resize photos, rename files, or edit any text files.

---

## One-time setup

You only ever do this part once.

### 1. Install Docker Desktop

This is the program that runs the Studio. Download it from
<https://www.docker.com/products/docker-desktop>, install it, and restart
your computer if it asks. You will never need to open it yourself — the
Studio starts it for you.

### 2. Accept Brandon's invitation

Brandon will invite you to the website on GitHub. You will get an email
with an **Accept** button — click it. Without this, the Publish button
cannot work, so do this before step 3.

### 3. Connect your GitHub account

This is what lets the Publish button put your work on the website.

1. Start the Studio (see below) and click **Sign in to publish** in the
   top-right corner.
2. The page lists the steps for getting a code from GitHub. Follow them,
   copy the long code, and paste it in.
3. That's it. You will not have to do this again.

If the code ever stops working — they expire eventually — just make
another one the same way.

---

## Starting the Studio

Double-click **`Start Indigo Studio.bat`**.

A black window appears while things warm up. The first time it can take a
minute or two; after that it is quick. Your browser opens on the Studio
by itself. You can close the black window — the Studio keeps running.

When you are finished for the day, double-click **`Stop Indigo
Studio.bat`**. Anything you have not published is kept and will be
waiting for you next time.

---

## Adding a project

### 1. Create it

Click **+ New project** and type the project name, e.g. *Bella Vista
Penthouse*. You can change it later.

### 2. Fill in the details

| Field | What to put |
|---|---|
| **Project name** | What visitors see as the title |
| **Category** | Choose from the list |
| **Category wording** | Fills in by itself — change it only if you want different words |
| **Location** | The suburb, e.g. *Bella Vista, NSW* |
| **Year completed** | e.g. *2026* |
| **Short summary** | One or two sentences. Shows on the gallery tile |
| **The story** | The client, the home, what they asked for, how you approached it. Leave a blank line between paragraphs |

Everything saves as you type. You will see **Saved** appear next to the
buttons at the top. There is no Save button to remember.

### 3. Add the photos

Click **Choose photos**, or drag them straight onto the dotted box. Pick
as many as you like at once — 3 to 8 works nicely for a project.

**Use the photos straight off your camera or phone.** Do not resize them
first. The Studio shrinks them to the right size for the web, rotates
them the right way up, and names the files properly. A 5 MB photo
typically comes out around 200 KB with no visible difference.

Then for each photo:

- Write a **heading** (e.g. *The Living Room*)
- Write a short paragraph **about this photo** — what was done in the
  room, the materials, the choices you made
- Use **▲ ▼** to change the order
- Click **Make cover** on the one you want showing on the gallery tile

### 4. Look at it

Click **Preview ↗** to see the real project page in a new tab. There is a
small bar at the bottom of the preview with **Open Studio** to get back.

You can also click **View site** at the top at any time to browse the
whole website exactly as visitors will see it, with your changes in
place.

### 5. Put it live

Click **Publish** at the top right. You will see:

- a list of what is about to change
- a box for a short note to yourself (optional)
- the **Publish to the website** button

Press it and watch the four steps tick along. The last one tells you it
is live. The whole thing takes a minute or two, mostly waiting for
GitHub.

> If the website still looks the same afterwards, your browser is showing
> you a saved copy. Hold **Ctrl** and press **F5** to force it to fetch
> the new version.

---

## Changing a project that is already on the site

Click **Edit** next to it, change whatever you like, then **Publish**.
Exactly the same as adding one.

To edit the project you happen to be *looking at* in the preview, use
**Edit this project** in the bar at the bottom of the page.

## Changing the order of the gallery

Use the **▲ ▼** buttons on the Projects screen. Top of the list is first
on the page. Then **Publish**.

## Taking a project off the site

Two different things, and the Studio keeps them separate on purpose:

- **Hide** — comes off the website, stays on your computer. You can show
  it again whenever you like. This is the one you almost always want.
- **Delete permanently** — erases the folder and its photos from your
  computer for good. You have to type *delete* to confirm. There is no
  undo.

---

## When Brandon changes the website

Sometimes Brandon will change the site himself — a new page, a design
tweak. Your copy then needs those changes before you publish, or you
would be working from an older version.

The Studio handles this for you:

- **Every time you start it**, it quietly fetches anything new.
- **While it is open**, if something changes, a gold bar appears under
  the top bar: *"The website has been updated elsewhere."* Click **Get
  the latest**.

It is safe to click at any time. Work you have in progress is kept — it
is set aside, the new changes come in underneath, and your work goes
back on top. Nothing you have written is lost.

Very occasionally your work and Brandon's will touch the same thing, and
the Studio will say so rather than guess. Nothing is lost then either;
just send him a message.

## Updating the Studio itself

Different from the above: that keeps the *website* current, this updates
the *app*. When Brandon improves the Studio, he will tell you to
double-click **`Update Indigo Studio.bat`**.

It downloads the new version, installs it, and rebuilds — a minute or
two. Your projects and your GitHub sign-in are deliberately left
untouched.

## If something looks wrong

**A project says "needs attention."** Something is not filled in yet.
Click Edit and the missing pieces are listed in a box at the top. This is
also why Publish sometimes refuses — it will not put a half-finished
project on the website. Either finish it, or **Hide** it and publish the
rest.

**"Your changes clashed with a change made elsewhere."** Brandon has
edited the website at the same time. Nothing is lost — your work is still
there. Send him a message and he will sort it out.

**I want to throw away everything since my last publish.** Publish screen
→ **Discard my unpublished changes**. You have to type *discard*. The live
website is not touched.

**The Studio will not start.** Open Docker Desktop and wait until it says
*Engine running*, then try again. If it still will not start, send
Brandon the text from the black window.

---

## The short version

1. Double-click **Start Indigo Studio.bat**
2. **+ New project**, fill in the form, drag the photos in
3. Write a heading and a paragraph for each photo
4. **Preview ↗** to check it
5. **Publish**

Your photos and text live in the `site` folder next to the Start file, so
you can always see them in File Explorer. Nothing is ever deleted
without you confirming it.
