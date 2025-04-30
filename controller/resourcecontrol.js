const resourceModel = require("../model/resource");
const axios = require("axios");
require("dotenv").config();

//function to get the resource function (TEAM) from the resource group
function determineResourceFunction(resourceGroup) {
  // Parse department mappings from the .env file
  const departmentMappings = {
    REBL: JSON.parse(process.env.REBL_DEPT || '[]'),
    TBL: JSON.parse(process.env.TBL_DEPT || '[]'),
    Administration: JSON.parse(process.env.ADMIN_DEPT || '[]'),
    "Resourcing & Facilitation": JSON.parse(process.env.RES_FAC_DEPT || '[]'),
    Finance: JSON.parse(process.env.FIN_DEPT || '[]'),
    Technology: JSON.parse(process.env.IT_DEPT || '[]'),
    Leadership: JSON.parse(process.env.LEAD_DEPT || '[]'),
    Talent: JSON.parse(process.env.TALENT_DEPT || '[]'),
    "Project Manangement": JSON.parse(process.env.PROJ_MGMT_DEPT || '[]'),
    Custom: JSON.parse(process.env.CUSTOM_DEPT || '[]'),
  };

  // Iterate through the department mappings to find a match
  for (const [functionName, departments] of Object.entries(departmentMappings)) {
    if (departments.includes(resourceGroup)) {
      return functionName; // Return the matching function name
    }
  }

  // If no match is found, return 'Unknown'
  return 'Unknown';
}

// Function to determine the resource role
    async function determineResourceRole(resourceData) {
      // Check if the resource is an Admin
      if (
        resourceData.ResourceName === "Anish Thomas" ||
        resourceData.ResourceName === "Parvind Kumar Bhagat"
      ) {
        return "Admin";
      }
    
      // Check if the resource is their own manager
      if (resourceData.ResourceId === resourceData.ResourceTimesheetManageId) {
        return "Manager";
      }
    
      // Check if the resource is a manager for any other resource
      const isManagerForOthers = await resourceModel.exists({
        resourceManagerId: resourceData.ResourceId,
      });
    
      if (isManagerForOthers) {
        return "Manager";
      }
    
      // Default to Member if no other conditions are met
      return "Member";
    }

  // function to fill manager Name from Manager id of each resource

  async function fillManagerNames() {
    try {
      // Fetch all resources
      const resources = await resourceModel.find();

      // Create a map of resourceId to resourceName
      const resourceMap = resources.reduce((map, resource) => {
        map[resource.resourceId] = resource.resourceName;
        return map;
      }, {});
      // console.log(resourceMap);
      // Update each resource with the manager's name
      for (const resource of resources) {
        if (
          resource.resourceManagerId &&
          resourceMap[resource.resourceManagerId]
        ) {
          resource.resourceManagerName =
            resourceMap[resource.resourceManagerId];
          await resource.save();
        }
      }

      console.log("Manager names updated successfully.");
    } catch (error) {
      console.error("Error updating manager names:", error);
    }
  }

  //function to initialize resource data if resources collection is empty
  async function initializeResources(accessToken) {
    try {
        // console.log("refresh resource controller function called");
      const count = await resourceModel.countDocuments();
      if (count === 0) {
        console.log("Resource collection is empty. Adding resources...");

        
        if (!accessToken) {
          console.log("access token mission. could not fetch resource data. redirecting to login page.");
          res.redirect("/login");
        } else {
          const resourceAPIresponse = await axios.get(
            "https://chrysalishrd.sharepoint.com/pwa/_api/ProjectData/Resources",
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/json",
              },
            }
          );
          const RL = resourceAPIresponse.data.value;
          console.log(`The number of resources in the RL are: ${RL.length}`);
          // console.log(`first resource email`)
          for (const resourceData of RL) {
            const {
              ResourceId,
              ResourceEmailAddress,
              ResourceDepartments,
              ResourceName,
              ResourceTimesheetManageId,
            } = resourceData;
            const resourceRole = await determineResourceRole(resourceData);
            const resourceFunction = determineResourceFunction(
              ResourceDepartments
            );
            const resource = new resourceModel({
              resourceId: ResourceId,
              resourceName: ResourceName,
              resourceEmail: ResourceEmailAddress,
              resourceGroup: ResourceDepartments,
              resourceManagerId: ResourceTimesheetManageId,
              resourceRole: resourceRole,
              resourceFunction: resourceFunction,
            });
            // console.log(`The resource data is: ${resource} `);
            try {
              await resource.save();
              // console.log(`saved resource: ${ResourceName}`);
            } catch (error) {
              console.error(`Error saving resource: ${ResourceName}`, error);
            }
          }
        }
        //Once the colection is initialized fill manager details from mananger id
         await fillManagerNames();
      } else {
        console.log("Resource collection is not empty. No action taken.");
      }
    } catch (err) {
      console.error("Error checking resource collection", err);
    }
  }


  module.exports = initializeResources ;