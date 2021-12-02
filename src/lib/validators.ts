export const validateInt: (minInclusive: number, maxInclusive: number) => CustomValidatorFunction = (minInclusive, maxInclusive) =>
{
  return (value: any) =>
  {
    value = parseInt(value);
    
    return {
      success: !(isNaN(value) || value < minInclusive || value > maxInclusive),
      value
    };
  };
};

export const validateArray: (constraint: ParamConstraint) => CustomValidatorFunction = (constraint: ParamConstraint) =>
{
  return (value: any) =>
  {
    value = JSON.parse(value);

    return {
      success: Array.isArray(value) && value.every(v => validateParam(v, constraint)),
      value
    };
  };
};

export type CustomValidatorFunction<T extends any = any> = (value: any) => CustomValidatorReturnValue<T>;

export interface CustomValidatorReturnValue<T extends any = any>
{
  value: T;
  success: boolean;
}

function validateParam(param: any, constraint: ParamConstraint): CustomValidatorReturnValue
{
  if (typeof(constraint) === "function")
  {
    return constraint(param);
  }
  else
  {
    switch (constraint)
    {
      case "float":
      {
        const value = parseFloat(param);
        return { success: !isNaN(value), value };
      }
      case "int":
      {
        const value = parseFloat(param);
        return { success: !isNaN(value), value };
      }
      case "date":
      {
        const value = new Date(param);
        return {
          value,
          success: !isNaN(+value)
        };
      }
      case "string": return { success: true, value: param };
      case "bool": return { success: param === true || param === false, value: param };
      default: return { success: false, value: param }
    }
  }
}

export type ParamConstraint = "int" | "string" | "float" | "bool" | "date" | CustomValidatorFunction;
export type ParamConstraints<T extends string = string> = Record<T, ParamConstraint>;

export function validateParams<S extends string, T extends Record<S, any> = Record<S, any>>(body: Record<string, any>, constraints: ParamConstraints<S>): T | false
{
  const ret: Record<string, any> = {};
  
  for (const paramName in constraints)
  {
    const paramConstraint: ParamConstraint = constraints[paramName];
    const printErr = () => console.log(`bad param ${paramName}: ${body[paramName]}`);

    if (!body.hasOwnProperty(paramName))
    {
      printErr();
      return false;
    }
    else
    {
      const result = validateParam(body[paramName], paramConstraint);
      if (result.success)
      {
        ret[paramName] = result.value;
      }
      else
      {
        printErr();
        return false;
      }
    }
  }
  
  return ret as T;
}