const express = require("express");
const linkedIn = require("linkedin-jobs-api");
const bodyParser = require("body-parser");
const fs = require("fs");
const cors = require("cors");
const { getJson } = require("serpapi");
const axios = require("axios");
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
require("dotenv").config();

const port = 5000;

const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const apiKey = process.env.SERP_API_KEY;
const region = "vn";
const language = "vi";
const loadHistoryFromFile = (jsonPath) => {
  try {
    const historyData = fs.readFileSync(jsonPath, "utf8");
    const history = JSON.parse(historyData);
    return history;
  } catch (error) {
    console.error("Error reading history file: ", error);
    return [];
  }
};

function UpdateConversation(role, text, JsonArray) {
  const newElement = {
    role: role,
    parts: [
      {
        text: text,
      },
    ],
  };
  JsonArray.push(newElement);
  return JsonArray;
}

let chatLog = loadHistoryFromFile("train-context.json");

const askGemini = async (question, res) => {
  let tryCount = 0;

  const handleError = (error) => {
    console.error("Error: ", error.message);
    res.status(500).json({ error: error.message });
  };

  const handleRetry = async (text) => {
    tryCount++;
    console.log("Trying times: ", tryCount);
    console.log(text);

    if (tryCount > 5) {
      console.error("Exceeded maximum retries.");
      res.status(500).json({ error: "Exceeded maximum retries." });
    } else {
      await askGemini(
        `I want a better answer, and remember to provide response in JSON format as my example. My question: ${question}`,
        res
      );
    }
  };

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    const generationConfig = {
      temperature: 0.9,
      topK: 1,
      topP: 1,
      maxOutputTokens: 2048,
    };

    const safetySettings = [
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
      },
    ];
    const chat = model.startChat({
      generationConfig,
      safetySettings,
      history: chatLog,
    });

    const result = await chat.sendMessage(question);
    const response = result.response;
    const text = response
      .text()
      .replaceAll("json", "")
      .replaceAll("```", "")
      .trim();

    try {
      const jsonData = JSON.parse(text);
      res.json(jsonData);
      console.log(response.text().trim());
      chatLog = UpdateConversation("user", question, chatLog);
      chatLog = UpdateConversation("model", response.text().trim(), chatLog);
    } catch (error) {
      await handleRetry(text);
    }
  } catch (error) {
    handleError(error);
  }
};

app.post("/ask", async (req, res) => {
  const { question } = req.body;
  await askGemini(question, res);
});

// https://github.com/VishwaGauravIn/linkedin-jobs-api
app.post("/findJobs", async (req, res) => {
  try {
    const { title, level } = req.body;
    if (!title) {
      return res.status(400).json({ error: "Missing parameters" });
    }
    const queryOptions = {
      keyword: title,
      location: "Vietnam", // You can update the location as needed
      dateSincePosted: "past month", // You can adjust the date range
      jobType: "", // full time, part time, contract, temporary, volunteer, internship
      remoteFilter: "", // on site, remote, hybrid
      salary: "", // minimum salary in USD
      experienceLevel: level, // internship, entry level, associate, senior, director, executive
      limit: "100",
      sortBy: "recent", // recent, relevant
    };
    const response = await linkedIn.query(queryOptions);
    res.status(200).json(response);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.post("/findCompanyLocations", (req, res) => {
  const { company } = req.body;
  const queryParams = {
    engine: "google_local",
    q: company,
    google_domain: "google.com.vn",
    location: "Vietnam",
    hl: language,
    gl: region,
    api_key: apiKey,
  };

  getJson(queryParams, (json) => {
    res.json(json["local_results"]);
  });
});

app.get("/news", async (req, res) => {
  try {
    const { q } = req.query;
    const apiUrl = "https://newsapi.org/v2/everything";
    const response = await axios.get(apiUrl, {
      params: {
        q,
        sortBy: "popularity",
        apiKey: process.env.NEWS_API_KEY,
      },
    });

    const filteredArticles = response.data.articles.filter(
      (article) => article.urlToImage !== null
    );

    res.json(filteredArticles);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
