const axios = require('axios').default;
const fs = require('fs');
const { program } = require('commander');

const ACCOUNT_COOKIES_PATH = './account-cookies';
const REQUEST_HEADERS = {
	'headers': {
		'origin': 'https://watch.lolesports.com',
		'connection': 'keep-alive',
		'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36',
		'x-api-key': '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z'
	}
};

/*
 * TODO
 * Provide a split slug argument for users to specify which split they want to watch VODs for
 */
program.option("-SV", "--skip-vods", "Skips fetching and saving list of vods and vods-sorted", false);
program.option("-FM", "--force-mission", "Forces watching vods until there are no watch missions left", false);
program.parse(process.argv);
const args = program.opts();

const ACCS = [];
let vods = [];
let leagues = null;
let splits = null;

(async () => {
	if (args["SV"]) {
		console.log("User chose to skip VOD generation.");
		if (fs.existsSync('./vods-sorted.json')) {
			vods = JSON.parse(fs.readFileSync('./vods-sorted.json', 'utf8'));
		} else if (fs.existsSync('./vods.json')) {
			console.log(`Found vods.json but no vods-sorted.json. Please re-run the app without skipping VOD generation.`);
			process.exit(1);
		} else {
			console.log(`Please re-run the app without skipping VOD generation.`);
			process.exit(1);
		}
	} else {
		console.log("Generating VODs...");
		await generateVods();
		writeVodsToFile(vods);
		vods = sortAndFilterVods(vods);
		writeSortedVodsToFile(vods);
	}

	await generateAccounts(ACCOUNT_COOKIES_PATH, ACCS);
	for (const acc of ACCS) {
		acc.watchesLeft = await getMission(acc);
	}
	writeAccountsToFile(ACCS);

	const latestSplitVODs = vods.filter(split => split.split.slug == "worlds_2021");

	/*
	 * Currently the way we handle getting the number of missions left is ANY watch missions
	 * League also gives a separate mission for watching a Finals match
	 * So what if we run the program on a date BEFORE a Finals match even takes place?
	 * We would constantly loop over all vods until we exceed 3 attempts and then move on to the next account
	 * 
	 * So the way we can mitigate this is if we make sure to watch vods if there is more than one watch left
	 * AND if there is NOFinals match in our VODs, otherwise skip to the next account
	 * The only downside of doing it this way is the extra O(n) run to see if there is a Finals match
	 * 
	 * NOTE, IN worlds_2021 slug THE MISSION IS CALLED "Watching Worlds Finals"
	 * IN worlds_2020 slug THERE WAS ONLY A blockName "Knockouts" for the final match, and not Finals
	 * But in lcs_2021 there is a blockName "Finals"
	*/
	/* const latestSplitFinalsVODs = latestSplitVODs.map(split => {
		return {...split, matches: split.matches.filter(match => match.blockName == "Finals")};
	}); */
	const latestSplitFinalsVODs = { ...latestSplitVODs[0], matches: latestSplitVODs[0].matches.filter(match => match.blockName == "Finals") };
	for (const acc of ACCS) {
		let attempts = 1;
		let vodsToWatch;
		let vodsToWatchName;
		// Check to see if we have to watch any match
		if (args["FM"] || acc.watchesLeft > 1 && latestSplitFinalsVODs.matches.length == 0) {
			vodsToWatch = latestSplitVODs;
			vodsToWatchName = "any VODs";
		} else if (acc.watchesLeft > 0 && latestSplitFinalsVODs.matches.length > 0) {
			vodsToWatch = [latestSplitFinalsVODs];
			vodsToWatchName = "Finals VODs";
		} else {
			console.log(`Skipping ${acc.username} because we have nothing to watch, or are waiting for finals match.`);
			continue;
		}

		// Lets set a max attempt of 3 just in case
		while (acc.watchesLeft && attempts <= 3) {
			console.log(`Generating watches for ${acc.username} with attempt #${attempts} with VOD type of ${vodsToWatchName}.`);
			await generateWatches(acc, vodsToWatch, attempts++, latestSplitFinalsVODs.matches.length > 0);
		}
	}

	/* for (const acc of ACCS) {
		acc.watchesLeft = await getMission(acc);
	}
	writeAccountsToFile(ACCS); */
})();

/*
 * TODO
 * Modify watched VODs to save the slug of the split
 * That way we can make keep track of old split watched vods, and still have an idea of what we have to watch next time
 */
async function generateAccounts(account_cookies_path, accountArray) {
	if (fs.existsSync('./accounts.json')) {
		console.log('accounts.json exists');
		const accounts = JSON.parse(fs.readFileSync('./accounts.json', 'utf8'));
		for (const acc of fs.readdirSync(account_cookies_path).filter(path => path.endsWith(".json"))) {
			const accName = acc.substring(0, acc.indexOf('.json'));
			const foundAcc = accounts.find(account => account.username === accName);
			if (!foundAcc) {
				console.log(`Creating account for ${accName}`);
				accountArray.push({
					'username': accName,
					'watchesLeft': -1,
					'watchedVodIDs': [],
					'cookies': JSON.parse(fs.readFileSync(`${account_cookies_path}/${acc}`, 'utf8'))
				});
			} else {
				console.log(`Updating cookies for ${accName} (${account_cookies_path}/${acc})`);
				foundAcc.cookies = JSON.parse(fs.readFileSync(`${account_cookies_path}/${acc}`, 'utf8'));
				accountArray.push(foundAcc);
			}
		}
	} else {
		console.log('accounts.json doesn\'t exist');
		for (const acc of fs.readdirSync(account_cookies_path).filter(path => path.endsWith(".json"))) {
			const accName = acc.substring(0, acc.indexOf('.json'));
			console.log(`Creating account for ${accName}`);
			accountArray.push({
				'username': accName,
				'watchesLeft': -1,
				'watchedVodIDs': [],
				'cookies': JSON.parse(fs.readFileSync(`${account_cookies_path}/${acc}`, 'utf8'))
			});
		}
	}
}

async function generateVods() {
	await axios('https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US', REQUEST_HEADERS).then(async resp => {
		leagues = resp.data['data']['leagues'].sort((obj1, obj2) => obj1.priority - obj2.priority).map(league => {
			delete league.image;
			return league;
		});

		for (const league of leagues) {
			await axios(`https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`, REQUEST_HEADERS).then(resp2 => {
				splits = resp2.data['data']['leagues'][0]['tournaments'];
			});

			for (const split of splits) {
				await axios(`https://esports-api.lolesports.com/persisted/gw/getCompletedEvents?hl=en-US&tournamentId=${split.id}`, REQUEST_HEADERS).then(resp3 => {
					console.log(`Number of matches in ${split.slug}(${split.id}) is: ${resp3.data['data']['schedule']['events'].length}`);
					resp3.data['data']['schedule']['events'].reverse(); // recent to oldest
					vods.push({
						'league': league,
						'split': split,
						'matches': resp3.data['data']['schedule']['events'].map(event => {
							const obj = {
								'startTime': event['startTime'],
								'blockName': event['blockName'],
								'matchID': event['match']['id'],
								'games': []
							};
							for (let gameNumber = 0; gameNumber < event['games'].length; gameNumber++) {
								if (event['games'][gameNumber]['vods'].length != 0) {
									if (event['games'][gameNumber]['vods'].length == 11) {
										obj.games.push({
											'gameNumber': gameNumber,
											'vodId': event['games'][gameNumber]['vods'][3]['parameter']
										});
									} else {
										obj.games.push({
											'gameNumber': gameNumber,
											'vodId': event['games'][gameNumber]['vods'][0]['parameter']
										});
									}
								}
							}
							return obj;
						})
					});
				});
			}
		}
	}).catch(err => {
		if (err.response.status == 403) {
			console.error("Error 403, Failed to fetch leagues. Potentially outdated API key.");
		}
		console.log(err);
	}).finally(() => {
		console.log(`Number of splits gathered: ${vods.length}`);
	});
}

async function getMission(account) {
	const MISSION_HEADER = {
		...REQUEST_HEADERS
	};
	MISSION_HEADER['withCredentials'] = true;
	MISSION_HEADER.headers['cookie'] = formatCookies(account.cookies);

	return axios('https://raptor.rewards.lolesports.com/v1/missions/free?locale=en_US', MISSION_HEADER).then(resp => {
		const watchAndEarnMission = resp.data['active'].filter(mission => mission.title['en_US'].startsWith('Watch'));
		if (watchAndEarnMission) {
			const numberOfWatchesReq = watchAndEarnMission.map(mission => mission.remainingSteps).reduce((prev, curr) => prev + curr);
			console.log(`Watches left for ${account.username}: ${numberOfWatchesReq}`);
			return numberOfWatchesReq;
		} else {
			console.log(`Watches left for ${account.username}: 0`);
			return 0;
		}
	}).catch(err => console.log(err));
}

async function generateWatches(account, vodArray, attempt, hasFinalsMatchesVODs) {
	let vodsWatched = 0;
	for (const split of vodArray) {
		for (const match of split.matches) {
			for (const game of match.games) {
				// If we are trying again, lets force watch the VOD despite having potentially already watched it
				const watchedVods = attempt > 1 ? [] : Array.from(account.watchedVodIDs);
				if (!watchedVods.includes(game.vodId)) {
					const START_INFO_HEADERS = {
						...REQUEST_HEADERS
					};
					delete START_INFO_HEADERS['headers']['x-api-key']
					START_INFO_HEADERS['headers']['origin'] = `https://lolesports.com`
					START_INFO_HEADERS['withCredentials'] = true;
					START_INFO_HEADERS.headers['cookie'] = formatCookies(account.cookies);
					START_INFO_HEADERS.method = "POST";
					START_INFO_HEADERS.data = {
						"stream_id": game.vodId,
						"source": "youtube",
						"stream_position_time": getModifiedDate(match.startTime),
						"tournament_id": split['split'].id
					};

					// sendWatchRequests(account, START_INFO_HEADERS);
					for (let i = 0; i < 10; i++) {
						await axios(`https://rex.rewards.lolesports.com/v1/events/watch`, START_INFO_HEADERS).then(() => {
							console.debug(`[${account.username}] [Attempt #${attempt}] Sending heartbeat #${i + 1} for ${split['split'].slug} VOD - ${split['split'].id}/${match.matchID}/${game.vodId} (Game #${game.gameNumber + 1})`);
						}).catch(err => {
							console.debug(`[${account.username}] [Attempt #${attempt}] Error ${err.response.status}: ${err.response.statusText} (${err.response.data})`);
							i--;
						});
						await sleep(getRandomIntInclusive(600, 1200));
					}
					console.log(`[${account.username}] [Attempt #${attempt}] Successfully watched a ${split['split'].slug} VOD - ${split['split'].id}/${match.matchID}/${game.vodId} (Game #${game.gameNumber + 1})`);
					watchedVods.push(game.vodId);
					account.watchedVodIDs = watchedVods;
					vodsWatched++;
					console.log(`[${account.username}] [Attempt #${attempt}] Watched a total of ${vodsWatched} vods`);
					// Lets sleep before we pull in case there is some delay
					await sleep(3000);
					account.watchesLeft = await getMission(account);
					writeAccountsToFile(ACCS);
					// console.log(`account.watchesLeft: ${account.watchesLeft}, hasFinalsMatchesVODs ${hasFinalsMatchesVODs} | if1: ${account.watchesLeft < 1}, if2: ${account.watchesLeft == 1} && ${!hasFinalsMatchesVODs}`);
					if (account.watchesLeft < 1) {
						console.log(`[${account.username}] [Attempt #${attempt}] No more watches required.`);
						return;
					} else if (!args["FM"] && (account.watchesLeft == 1 && !hasFinalsMatchesVODs)) {
						console.log(`[${account.username}] [Attempt #${attempt}] We have ${account.watchesLeft} watches left, but no Finals matches to watch.`);
						return;
					}
				}
			}
		}
	}
}

async function sendWatchRequests(account, headers) {
	for (let i = 0; i < 10; i++) {
		await axios(`https://rex.rewards.lolesports.com/v1/events/watch`, headers).then(() => {
			console.debug(`[${account.username}] Watched ${i}x ${headers.data['tournament_id']}/${headers.data['stream_id']}`);
		}).catch(err => {
			console.debug(`[${account.username}] Error ${err.response.status}: ${err.response.statusText} (${err.response.data})`);
			i--;
		});
		await sleep(getRandomIntInclusive(0, 3000));
	}
}

/*
 * The way the end result is sorted is its by day, and then from top to bottom
*/
function sortAndFilterVods(vodArray) {
	vodArray = vodArray.filter(obj => obj.matches.length != 0);
	vodArray.forEach(obj => obj.matches = obj.matches.filter(match => match.games.length != 0));
	return vodArray.sort((obj1, obj2) => Number(BigInt(new Date(obj2.split.endDate)) - BigInt(new Date(obj1.split.endDate))));
}

function writeAccountsToFile(accountArray) {
	fs.writeFileSync('./accounts.json', JSON.stringify(accountArray, null, 4));
	console.log(`Wrote accounts to accounts.json`);
}

function writeVodsToFile(vodArray) {
	fs.writeFileSync('./vods.json', JSON.stringify(vodArray, null, 4));
	console.log(`Wrote vods to vods.json`);
}

function writeSortedVodsToFile(vodArray) {
	fs.writeFileSync('./vods-sorted.json', JSON.stringify(vodArray, null, 4));
	console.log(`Wrote sorted vods to vods-sorted.json`);
}

function formatCookies(cookies) {
	return cookies.map(cookie => {
		return `${cookie.name}=${cookie.value}`;
	}).join('; ');
}

function getModifiedDate(dateAsString) {
	const date = new Date(dateAsString);
	// current time + (how many minutes to add * (1000 ms * 60 seconds))
	// current time + (how many minutes to add * 1 minute)
	date.setTime(date.getTime() + (getRandomIntInclusive(20, 27) * (1000 * 60))); // current time + (1 minute)
	return date;
}

function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomIntInclusive(min, max) {
	// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random#Getting_a_random_integer_between_two_values_inclusive
	min = Math.ceil(min);
	max = Math.floor(max);
	return Math.floor(Math.random() * (max - min + 1)) + min; // The maximum is inclusive and the minimum is inclusive
}