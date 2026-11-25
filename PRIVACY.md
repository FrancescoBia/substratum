# Privacy policy

_Last updated: 25 November 2026_

Substratum is self-hosted. This policy covers the Substratum Chrome extension, and the Substratum web app as published in this repository.

## The short version

The extension only talks to the Substratum instance you connect it to. The developer receives no data from it, and there are no analytics, no tracking and no third parties.

## What the extension sends, and where

When you choose **Save to Substratum** on an image or video, the extension sends three things to your Substratum instance:

- the address (URL) of the image or video
- the address of the page you saved it from
- the title of that page

Your instance then downloads the file and stores it in your library. Nothing is sent when you browse without saving.

The request goes only to the instance address you entered on the options page. Chrome attaches your instance's own sign-in cookie to the request so that the instance knows it's you. The extension doesn't read or store that cookie.

## What the extension stores on your device

Using Chrome's local extension storage, the extension keeps:

- the address of your Substratum instance
- the list of sites where you switched on the overlay fix

Neither is sent anywhere. Removing the extension deletes both.

## The overlay fix

On sites where you switch it on, a small script packaged with the extension runs when you right-click. For a moment, it makes empty layers covering an image or video click-through, so that Chrome's own image menu appears. It doesn't read, store or send anything from the page.

## Permissions

The extension asks for access to a website only when you act: your own instance's address when you pair it, and each site you switch the overlay fix on for. It never has access to all websites. You can revoke any of these at `chrome://extensions`.

## Your data on your instance

What you save lives on the Substratum instance you or someone you trust runs. Whoever runs that instance controls the data, including backups and deletion. The developer of Substratum has no access to any instance they don't run themselves.

Boards are private unless you publish them. A published board is visible to anyone who has its link.

## Connections the web app makes

A Substratum instance contacts other servers only in these cases:

- **The site an item comes from.** To save an image or video, the instance downloads it from its original address, as any browser would. That site sees the instance's IP address.
- **GitHub, to check for updates.** About every six hours, the instance asks GitHub's public API for the latest Substratum release, to show a notice when a newer version exists. The request carries no information about you or your library. GitHub sees the instance's IP address, under [GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
- **Your storage bucket, if you configure one.** Instances set up with an S3-compatible bucket store images there, under that provider's terms.

## Data sale and use

User data is not sold, and it isn't used for advertising, for creditworthiness or lending decisions, or for any purpose other than saving items to your own library.

## Changes and contact

Changes to this policy are made in this file, and its history shows every change. Questions go to [GitHub issues](https://github.com/FrancescoBia/substratum/issues).
