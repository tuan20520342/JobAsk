const express = require("express");
const cors = require("cors");
const fs = require("fs");
const axios = require("axios");
const bodyParser = require("body-parser");
const { getJson } = require("serpapi");
const linkedIn = require("linkedin-jobs-api");
const {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
} = require("@google/generative-ai");
require("dotenv").config();

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
async function getImageAsBase64(url) {
  try {
    // Fetch the image using axios
    const response = await axios.get(url, { responseType: "arraybuffer" });

    // Convert the image buffer to base64
    const base64Data = Buffer.from(response.data, "binary").toString("base64");

    return base64Data;
  } catch (error) {
    console.error("Error fetching or converting the image:", error.message);
    throw error;
  }
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
        `I want a better answer, and remember to provide response in JSON format as my example and use English for the answer. My question: ${question}`,
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

app.post("/askImg", async (req, res) => {
  const { question, imageUrl } = req.body;
  try {
    const base64Image = await getImageAsBase64(imageUrl);
    const model = genAI.getGenerativeModel({ model: "gemini-pro-vision" });

    const parts = [
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Image,
        },
      },
      {
        text:
          "You are only allowed to answer questions related to IT job seeking, and use English to answer. Your answer must be clear and less than 100 words. You can give me some useful advice if necessary or provide some information related to the job in the image if any. My question: " +
          question,
      },
    ];

    const result = await model.generateContent({
      contents: [{ role: "user", parts }],
      generationConfig: {
        maxOutputTokens: 4096,
      },
    });

    const responseText = result.response.text().trim();
    chatLog = UpdateConversation("user", question, chatLog);
    chatLog = UpdateConversation("model", responseText, chatLog);
    res.json({ answer: responseText });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post("/ask", async (req, res) => {
  const { question } = req.body;
  await askGemini(question, res);
});

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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
