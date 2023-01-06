

Variables="{\r\n   \"EXCEPTION_SNS\"=\"arn:aws:sns:eu-west-2:048464312507:Exception\",\r\n   \"AWS_REGION_CUSTOM\"=\"eu-west-2\",\r\n   \"VEHICLE_SNS\"=\"arn:aws:sns:eu-west-2:048464312507:Vehicle\",\r\n   \"PROSPECT_SNS\"=\"arn:aws:sns:eu-west-2:048464312507:Prospect\",\r\n   \"REMINDEREMAIL_SNS\"=\"arn:aws:sns:eu-west-2:048464312507:ReminderEmail\",\r\n   \"MONGODB\"='mongodb+srv://MaxDrive_User2:maxdrive123@london-cluster-vams.xkxgb.mongodb.net/?retryWrites=true&w=majority'\r\n}"

mkdir -p lambda_functions

functions=(`aws lambda list-functions --query 'Functions[*].[FunctionName]'`)
for i in "${functions[@]}"
do
   #delete functions 1-by-1   
    functionName="$i"
   aws lambda update-function-configuration --function-name pickUpVehicle --environment Variables="{\
   EXCEPTION_SNS=arn:aws:sns:eu-west-2:048464312507:Exception,\
   AWS_REGION_CUSTOM=eu-west-2,\
   VEHICLE_SNS=arn:aws:sns:eu-west-2:048464312507:Vehicle,\
   PROSPECT_SNS=arn:aws:sns:eu-west-2:048464312507:Prospect,\
   REMINDEREMAIL_SNS=arn:aws:sns:eu-west-2:048464312507:ReminderEmail,\
   MONGODB=mongodb+srv://MaxDrive_User2:maxdrive123@london-cluster-vams.xkxgb.mongodb.net/?retryWrites=true&w=majority \
}"
done

echo "Completed Downloading all the Lamdba Functions!"

for i in */; do zip  -r -j "../${i%/}.zip" "$i" & done; wait

yourfilenames=`ls activateVehicle/*`;for i in yourfilenames; do echo ${i} & done; wait