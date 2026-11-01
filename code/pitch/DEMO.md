# Demo session

The live demo answers the reviewer's two questions from slide 01 with a real, recorded session.
The story is deliberately non-technical: a running club adds a newsletter sign-up to its website.
Slides 01 and 02 are written to match this session; after recording it, update the wall on
slide 02 and the PR numbers on slide 01 from the real transcript if they differ.

## Setup (once)

In a fresh folder with the yolo-twice plugin enabled (`/yolo:twice mode attentive`):

```text
Create a simple website for a local running club, "Rhine Runners Basel": a home page, training times and a contact page, in plain HTML and CSS, plus a tiny server that can save form entries to a file. Initialise git and commit it as "First version of the club website".
```

## The session (new session, one prompt at a time)

1. ```text
   Add a newsletter sign-up to the website. Before building it, have a helper agent find out what the rules and good practice are for collecting email addresses in Switzerland and the EU, then decide how to do it and explain why.
   ```
2. ```text
   Also add a CAPTCHA to the sign-up form, so bots can't flood us with fake sign-ups.
   ```
3. ```text
   Actually, drop the CAPTCHA: our members find it annoying, and our mailing tool already filters out spam sign-ups. Remove it again.
   ```
4. ```text
   Add a short, friendly privacy note under the sign-up form.
   ```
5. ```text
   Commit this as "Add a newsletter sign-up".
   ```

Commit the `.yolo-twice/` folder together with the website.

## In the demo

| Reviewer's question | Where the answer is |
|---|---|
| Why do people have to confirm their email twice? | Turn 1 on the map: the helper agent's frame holds the research on consent rules, the next Claude step explains the choice of double opt-in. |
| Who decided to drop the spam protection? | Search "CAPTCHA", filter **You**: turn 3, the club member, because members found it annoying and the mailing tool already filters spam. |

Then copy the link to that step: it opens the same view for a colleague.

Claude may not choose double opt-in in every run. Do a dry run, and phrase the reviewer's first
question on slide 01 after what it actually decided.
