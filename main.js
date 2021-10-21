const axios = require('axios').default;
const fs = require('fs');

const ACCOUNT_COOKIES_PATH = './account-cookies';
const REQUEST_HEADERS = {
	'headers': {
		'origin': 'https://watch.lolesports.com',
		'connection': 'keep-alive',
		'x-api-key': '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z',
		'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/75.0.3770.100 Safari/537.36',
	}
};
const ACCS = [];
let vods = [];
let leagues = null;
let splits = null;

(async () => {

	await generateAccounts(ACCOUNT_COOKIES_PATH, ACCS);
	for (const acc of ACCS) {
		acc.watchesLeft = await getMission(acc);
	}
	await generateVods();
	writeVodsToFile(vods);
	vods = sortAndFilterVods(vods);
	writeSortedVodsToFile(vods);
	writeAccountsToFile(ACCS);

	for (const acc of ACCS) {
		if (acc.watchesLeft > 0) {
			await generateWatches(acc, vods);
		}
	}

	for (const acc of ACCS) {
		acc.watchesLeft = await getMission(acc);
	}
	writeAccountsToFile(ACCS);
})();

async function generateAccounts(account_cookies_path, accountArray) {
	if (fs.existsSync('./accounts.json')) {
		console.log('accounts.json exists');
		const accounts = JSON.parse(fs.readFileSync('./accounts.json', 'utf8'));
		for (const acc of fs.readdirSync(account_cookies_path)) {
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
				console.log(`Updating cookies for ${accName}`);
				foundAcc.cookies = JSON.parse(fs.readFileSync(`${account_cookies_path}/${acc}`, 'utf8'));
				accountArray.push(foundAcc);
			}
		}
	} else {
		console.log('accounts.json doesn\'t exist');
		for (const acc of fs.readdirSync(account_cookies_path)) {
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

	return axios('https://raptor.rewards.lolesports.com/v1/missions?locale=en_US', MISSION_HEADER).then(resp => {
		const watchAndEarnMission = resp.data['activeMissions'].find(mission => mission.missionInfo.title['en_US'].startsWith('Watching Worlds'));
		if (watchAndEarnMission) {
			console.log(`Watches left for ${account.username}: ${watchAndEarnMission.remainingSteps}`);
			return watchAndEarnMission.remainingSteps;
		} else {
			console.log(`Watches left for ${account.username}: 0`);
			return 0;
		}
	});
}

async function generateWatches(account, vodArray) {
	let vodsWatched = 0;
	for (const split of vodArray) {
		for (const match of split.matches) {
			for (const game of match.games) {
				const watchedVods = Array.from(account.watchedVodIDs);
				if (!watchedVods.includes(game.vodId)) {
					const START_INFO_HEADERS = {
						...REQUEST_HEADERS
					};
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
							console.debug(`[${account.username}] Watched ${i + 1}x ${START_INFO_HEADERS.data['tournament_id']}/${START_INFO_HEADERS.data['stream_id']}`);
						}).catch(err => {
							console.debug(`[${account.username}] Error ${err.response.status}: ${err.response.statusText} (${err.response.data})`);
							i--;
						});
						await sleep(getRandomIntInclusive(600, 1200));
					}
					console.log(`[${account.username}] Successfully watched one vod`);
					watchedVods.push(game.vodId);
					account.watchedVodIDs = watchedVods;
					vodsWatched++;
					console.log(`[${account.username}] Watched ${vodsWatched} vods`);
					account.watchesLeft = account.watchesLeft - 1;
					writeAccountsToFile(ACCS);
					/* if (account.watchesLeft < 1) {
						return;
					} */
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