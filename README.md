# Activate Vehicle

This folder contains the Lambda function to activate vehicle if the document status is "submittedForActivation" . 

# Prospect Create Or Update

This folder contains the lambda function for the Prospect to create or update . It is mainly going to check that the prospect is already there .If it is there .Then we will either create or update the prospect .

# Vehicle Create Or Update

This folder contains the lambda function for the Vehicle to create or update . It is mainly going to check that the Vehicle is already there then check the time difference when it is there and when it is activated .If it is there .Then we will either create or update the vehicle . 

# How to use it 
- In vscode Use the Extension AWS Toolkit 
- Add the aws credentials
- In AWS Toolkit Select the region .
- Select Lambda .Right click on lambda and upload it onto the lambda function .

AWS Toolkit - [Youtube Link](https://www.youtube.com/watch?v=ld9FmI5-h8U)
