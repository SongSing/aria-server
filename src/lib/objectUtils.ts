type ValueOf<T> = T[keyof T];

type MapTo<T, U> = {
    [P in keyof T]: U
}

export function mapObject<T extends object, U>(obj: T, mappingFn: (v: ValueOf<T>) => U): MapTo<T, U> {
  let newObj = {} as MapTo<T, U>;
  for (let i in obj) {
    if (obj.hasOwnProperty(i)) {
      newObj[i] = mappingFn(obj[i]);
    }
  }
  return newObj;
}

export function sliceObject<T extends object, K extends readonly (keyof T)[]>(obj: T, keys: K): Pick<T, K[number]> {
  const ret = {} as Pick<T, K[number]>;

  for (const key in obj) {
    if (keys.includes(key)) {
      ret[key] = obj[key]
    }
  }

  return ret;
}