
const site = window.location.hostname

if (site.includes('store.steampowered.com')) { 
    updateInfo();
}

function getIdByUrl(url) {
	let appid;
	let pattern = /https:\/\/store\.steampowered\.com\/app\/(\d+)\/([\w\d]+)/;
	let match = url.match(pattern);
	if (match) {
		appid = match[1];
		let name = match[2];
		console.log("Successfully find appid.")
		return {
			id: appid,
			platform: "steam"
		};
	} else if (!match && url.includes("store.steampowered.com")) {
		console.log("Not in app page")
		return
	} else {
		console.log("URL does not match the pattern, page to steam");
		chrome.tabs.create({ url: "https://store.steampowered.com" })
		return ;
	}
}

function updateInfo(params = {
    numOfTopics: localStorage.getItem('num-of-topics'),
    numOfReviews: localStorage.getItem('num-of-reviews'),
    query: localStorage.getItem('query'),
    dataInCache: localStorage.getItem('data-in-cache')
}) {
    const tabURL = window.location.toString();
    console.log("query: ", params.query);

    // Extract information from the URL
    const app = getIdByUrl(tabURL);
    let searchParams = {
        params: params.numOfTopics,
        query: params.query
    };
    const path = `${app.platform}/${app.id}/data?${new URLSearchParams(searchParams)}`;
    const URI = 'https://www.steamscope.net/' + path;
    //const LOCAL = 'https://127.0.0.1:8080/' + path;

    const dataInCache = JSON.parse(params.dataInCache);

    // GET data from DB; If not present then GET from API then POST data
    function handleUpdateReviewsResponse(responseData, params, app) {
        if (responseData && "reviews" in responseData) {
            if (isQueryEmpty(params.query)) {
                cacheReviewsData(app.id, responseData.reviews);
            }
            initTopicModel();
            showBubbleChart(responseData);
        } else{
            var dashboard = document.getElementById("dashboard");
            dashboard.innerHTML = "Not found enough data to analyze.";
            
        }
    }
    
    function isQueryEmpty(query) {
        return Object.keys(JSON.parse(query)).length === 0;
    }
    
    function cacheReviewsData(appId, reviews) {
        let data = {
            appid: appId,
            reviews: reviews
        };
        console.log('Caching reviews data:', data);
        localStorage.setItem('data-in-cache', JSON.stringify(data));
    }
    
    function updateReviewsAndHandleResponse(app, params, dataInCache, url) {
        updateReviews(app.id, params.numOfReviews, dataInCache, url)
            .then(responseData => {
                hideLoadingScreen();
                console.log('Received response data:', responseData);
                handleUpdateReviewsResponse(responseData, params, app);
            })
            .catch(err => {
                console.error('Error in updateReviews:', err);
                hideLoadingScreen();
            });
    }
    
    updateReviewsAndHandleResponse(app, params, dataInCache, URI);  
}

async function getReviewsPerRequest(appid, params) {
    const url = `https://store.steampowered.com/appreviews/${appid}`;
    const response = await fetch(url + "?" + new URLSearchParams(params));
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    } else {
        const data = await response.json();  // convert the response to JSON format
        return data;
    }
}

async function getReviewsFromAPI(appid, n, cursor = '*') {
    let reviews = [];
    let params = {
        json: 1,
        filter: 'recent',
        language: 'english',
        day_range: '',
        review_type: 'all',
        purchase_type: 'all',
    };
    let numRequests = Math.floor(n / 100) + 1;

    for (let idx = 0; idx < numRequests; idx++) {
        params.cursor = cursor;

        if (idx === numRequests - 1) {
            params.num_per_page = n % 100;
        } else {
            params.num_per_page = 100;
        }
        const response = await getReviewsPerRequest(appid, params);
        
        if (response.cursor) {
            cursor = response.cursor;
        } else {
            console.warn("no cursor in response", response);
            break;
        }
        reviews = reviews.concat(response.reviews);
      
    }
    return {reviews, cursor};
}


function hideLoadingScreen() {
    var loadingScreen = document.getElementById("loading-screen");
    if (loadingScreen) {
        loadingScreen.style.display = "none";
    } else {
        console.error("Loading screen element not found");
    }
}
function displayLoadingScreen() {
    var loadingScreen = document.getElementById("loading-screen");
    if (loadingScreen) {
        loadingScreen.style.display = "flex";
    } else {
        console.error("Loading screen element not found");
    }
}
async function updateReviews(appid, n, data, url) {
    const response = await fetch(url);
    if (response.status == 200) {
        console.log("data received from db!");
        const data = response.json();
        return data;
    } else if (response.status == 202) {
        return response.json();
       
    } else if (response.status == 204) {
        console.log("data not received from db!");
        let reviewObj;
        if (appid === data.appid) {
            console.log("no scrap")
            return data.reviews
        } else {
            console.log("new scrap");
            reviewObj = await getReviewsFromAPI(appid, n);
            reviewObj.reviews = steamFormatter(reviewObj.reviews);
       
        }
        console.log("posting data..")
        return postData(url, reviewObj.reviews)
    } else {
        console.error("error in GET method, status", response.status);
    }    
}
async function postData(uri, postData) {
    if (postData.length <= 100) {
        
        console.log(`Not enough data. Current number: ${postData.length}`);
        return
    }
    try {
        const response = await fetch(uri, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(postData),
        });
        if (!response.ok) {
            throw new Error('Request failed. Returned status: ' + response.status);
        }
        const data = await response.json();
        return data;
    } catch (error) {
        console.error(error);
    }
}

function steamFormatter(data) {
    let newData = data
        .filter(({ review }) => {
            const wordCount = review.split(' ').length;
            return wordCount > 5 && wordCount < 100;
        })
        .map(({ review, voted_up }) => ({
            review,
            sentiment: voted_up ? 1 : 0
        }));
    return newData;
}