# Project: Travelhub

This project is a web application that provides real-time train and road traffic information in the UK.

Rail and road information is provided by National Rail API and Google Maps API respectively.

The rail and road destination information is provided by yaml configs in the config directory 

## General Instructions

- Do not read .env files, they are private.
- When trying to test the project with new changes, we must use docker, we do not run node, npm, npx or simlar commands locally. You may instead run the equivalent commands inside the docker container that is running for this project.
- When API keys are defined via environment variables, use them. Do not hardcode API keys in the code.
- When API keys are not defined via environment variables, fallback to web scraping.
- Always use live data from the APIs (National Rail API and Google Maps API or), do not use mock data unless explicitly asked to do so.
- Must not write any API keys in the code, code should load the keys from the environment variables only.
- When changes are made, make sure the readme is updated to reflect those changes so the project information stay accurate.

## Coding Style

- Create well structured, easy to maintain code.
- Break functionality into smaller functions and modular components where necessary.
- Separate api functionality from web scraping functionality.