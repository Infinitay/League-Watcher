# League Watcher

_Watches_ League of Legends VODs on their [lolesports](https://lolesports.com/vods/) page so you don't have to for the in-game missions. The benefits of using League Watcher is that everything is handled via requests and there is support for multiple accounts. This tool was created so that users with multiple accounts **don't have to re-watch VODs** on all their accounts all over. Not only does this help users save time but also bandwidth since everything is handled via requests. Also if you ever need the list of VODs for whatever reason, this tool saves them to the respective file in the same directory.

Please don't abuse this tool. Only use it if you have multiple accounts and have already watched the latest VODs at least once.

# Installation

1. Make sure you have a compatible version of node.js. I have tested and used this tool using node v16.1.0.

2. Install the required packages via `npm i`.

3. Supply the required account cookies within the `account-cookies` directory. If the folder does not exist, please create one.

# Setting up cookies

Preferably use the Chrome extension [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg).

1. Visit and log into the [VODs page on League's website]([lolesports](https://lolesports.com/vods/)).
2. Using EditThisCookie, open the extension and hit the _Export_ button to copy your cookies to your clipboard.
	![](https://i.imgur.com/QveOZ04.png)
3. Create a new `.json` file named with your account name to keep things organized.
4. Paste the cookies you copied from step 2 into the respective file from step 3.

# Additional Information

This was worked on about one to two years ago, so the code is not refactored. With that being said, there may be some bugs. Currently, sometimes League will not recognize a VOD as watched despite the program _watching_ the VOD. I'm not sure if that is because of some rate limit on League's end, or if it is because we did not watch enough of the VOD. Currently, there is hardcoded random watch length between 20 and 26 minutes because there is not an end time exposed for the match in League's VOD endpoint. I don't want to bother dealing with YouTube's API and involve another set of API keys for something that does not need to be this complicated. There are enough VODs to go around to complete the missions anyways.

Worst case scenario you run the program again. After all, you don't have to do anything once you set up the program.

If you are curious about the watch order, currently the order is the latest event -> the latest match day -> first game of the day to the last -> the first match of the series to the last

![](https://i.imgur.com/uvTcPBD.png)

# No Current Plans To

- Refactor
- Add support for specific events
	- Currently this tool will watch the latest VODs according to when League has uploaded them
	- At the moment I will force a check to run through only the latest split